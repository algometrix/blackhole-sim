// Schwarzschild geodesic raymarcher: per pixel, integrates the photon
// equation of motion  x'' = -1.5 * h^2 * x / r^5  (r_s = 1 units) with RK4
// and an adaptive step, accumulating the accretion disc at equatorial-plane
// crossings and testing the (tidally stretched) planet ellipsoid per step.
// Escaped rays sample the star cubemap along the bent direction; captured
// rays are the shadow. Alpha output is the horizon mask (0 = captured),
// consumed by the overlay scene pass for occlusion.
//
// Compile-time defines injected from TS: MAX_STEPS, USE_RK4, BEAM_EXP,
// R_CAPTURE, R_ESCAPE, STEP_K, DT_MIN, DT_MAX.

#include ./noise.glsl;

uniform vec3 uCamPos;
uniform mat3 uCamBasis;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uResolution;
uniform vec2 uJitter;
uniform float uTime;
uniform samplerCube uSky;
uniform float uRs;      // primary Schwarzschild radius (grows after a merger)
uniform int uBh2Active; // secondary inspiraling black hole
uniform vec3 uBh2Pos;
uniform float uBh2Rs;
uniform float uDiscInner;
uniform float uDiscOuter;
uniform float uDiscBrightness; // 0 disables the disc entirely
uniform float uJetStrength;  // 0 disables the polar jet
uniform float uWindStrength; // super-Eddington outflow; rises as the disc is fed
uniform int uPlanetActive;
uniform vec3 uPlanetPos;
uniform vec3 uPlanetRadii;
uniform mat3 uPlanetRot;    // local -> world
uniform mat3 uPlanetInvRot; // world -> local
uniform vec3 uPlanetColor;
uniform float uPlanetEmissive;

// Deflection of one center: -1.5 * rs * h^2 * d / |d|^5 with h taken about
// that center (exact for one hole; superposed when the secondary is active).
vec3 centerAccel(vec3 d, vec3 v, float rs) {
  vec3 h = cross(d, v);
  float r2 = dot(d, d);
  return -1.5 * rs * dot(h, h) * d / (r2 * r2 * sqrt(r2));
}

vec3 accelG(vec3 x, vec3 v) {
  vec3 a = centerAccel(x, v, uRs);
  if (uBh2Active == 1) a += centerAccel(x - uBh2Pos, v, uBh2Rs);
  return a;
}

bool isCaptured(vec3 x) {
  float cap = R_CAPTURE * uRs;
  if (dot(x, x) < cap * cap) return true;
  if (uBh2Active == 1) {
    vec3 d = x - uBh2Pos;
    float cap2 = R_CAPTURE * uBh2Rs;
    if (dot(d, d) < cap2 * cap2) return true;
  }
  return false;
}

float stepSizeAt(vec3 x) {
  float margin = length(x) - 0.9 * uRs;
  if (uBh2Active == 1) margin = min(margin, length(x - uBh2Pos) - 0.9 * uBh2Rs);
  return clamp(STEP_K * margin, DT_MIN, DT_MAX);
}

void integrateStep(inout vec3 x, inout vec3 v, float dt) {
#if USE_RK4
  vec3 a1 = accelG(x, v);
  vec3 xB = x + 0.5 * dt * v;
  vec3 vB = v + 0.5 * dt * a1;
  vec3 a2 = accelG(xB, vB);
  vec3 xC = x + 0.5 * dt * vB;
  vec3 vC = v + 0.5 * dt * a2;
  vec3 a3 = accelG(xC, vC);
  vec3 xD = x + dt * vC;
  vec3 vD = v + dt * a3;
  vec3 a4 = accelG(xD, vD);
  x += dt / 6.0 * (v + 2.0 * vB + 2.0 * vC + vD);
  v += dt / 6.0 * (a1 + 2.0 * a2 + 2.0 * a3 + a4);
#else
  // Midpoint (RK2) for the low-quality preset.
  vec3 a1 = accelG(x, v);
  vec3 xm = x + 0.5 * dt * v;
  vec3 vm = v + 0.5 * dt * a1;
  vec3 am = accelG(xm, vm);
  x += dt * vm;
  v += dt * am;
#endif
}

// Crude Planckian ramp: temperature scalar ~0 deep red -> ~1 white -> hotter blue.
vec3 blackbody(float t) {
  vec3 c = mix(vec3(0.55, 0.04, 0.0), vec3(1.0, 0.45, 0.12), smoothstep(0.0, 0.45, t));
  c = mix(c, vec3(1.0, 0.93, 0.82), smoothstep(0.45, 0.95, t));
  c = mix(c, vec3(0.72, 0.82, 1.0), smoothstep(0.95, 1.7, t));
  return c;
}

// Disc emission at an equatorial crossing. `marchDir` is our marching
// direction (camera -> scene); the photon physically travels the other way.
// Returns premultiplied rgb and coverage alpha.
vec4 discEmission(vec3 hit, vec3 marchDir) {
  float r = length(hit.xz);

  // Shakura–Sunyaev temperature profile, normalized to peak at 1.
  float q = max(1.0 - sqrt(uDiscInner / r), 0.0);
  float tProf = pow(uDiscInner / r, 0.75) * pow(q, 0.25) * 2.05;

  // Differential rotation: advect the noise field by the local Keplerian
  // angular speed so streaks shear into trailing spirals on their own.
  float omega = sqrt(0.5 * uRs / (r * r * r));
  float ang = omega * uTime;
  float ca = cos(ang);
  float sa = sin(ang);
  vec2 mq = vec2(hit.x * ca + hit.z * sa, -hit.x * sa + hit.z * ca);
  float n = fbm2(mq * 1.3 + vec2(3.7, -1.2));
  float n2 = fbm2(mq * 4.2 + vec2(-11.0, 7.0));
  float density = smoothstep(0.22, 0.85, n * 0.72 + n2 * 0.38);

  float fade = smoothstep(uDiscInner, uDiscInner * 1.18, r) *
               (1.0 - smoothstep(uDiscOuter * 0.78, uDiscOuter, r));
  float alpha = clamp(density * 1.25, 0.0, 0.92) * fade;
  if (alpha < 0.004) return vec4(0.0);

  // Doppler + gravitational shift for a circular geodesic emitter, using the
  // bent photon direction so the lensed secondary image beams correctly too.
  vec3 phiHat = normalize(vec3(-hit.z, 0.0, hit.x));
  float beta = clamp(sqrt(0.5 * uRs / max(r - uRs, 0.3)), 0.0, 0.9);
  float gamma = inversesqrt(1.0 - beta * beta);
  float cosA = dot(-marchDir, phiHat);
  float g = sqrt(max(1.0 - 1.5 * uRs / r, 0.0)) / (gamma * (1.0 - beta * cosA));

  vec3 col = blackbody(tProf * g) * tProf * pow(g, BEAM_EXP);
  col *= uDiscBrightness * 16.0 * (0.3 + 0.9 * density);
  return vec4(col * alpha, alpha);
}

// Optically thin polar jet: two narrow cones along the disc axis, filled with
// braided filaments that twist with height and drift outward. Emission only,
// so it never hides what is behind it, but it is integrated inside the
// geodesic march, so the jet bends with the light near the hole.
//
// The plasma speed is art-directed (no MHD here), but the brightness contrast
// between the two cones is the real relativistic Doppler boost: an approaching
// jet is beamed by delta^3, which is why one side of a real AGN is faint.
const float JET_SPEED = 0.75;
/** Emission per unit march length. The march crosses these volumes in dozens
 *  of steps, so these are far below the disc's surface-emission scale. */
const float JET_EMISSION = 5.0;
const float JET_TWIST_RATE = 0.85;   // radians of braid per r_s of height
const float JET_DRIFT_SPEED = 0.6;   // filaments crawling outward
const float JET_NOISE_SCALE = 2.4;
const float JET_BASE_RADIUS = 0.45;
const float JET_OPENING = 0.10;
const float JET_LENGTH = 30.0;
const float JET_FADE = 13.0;

vec3 jetEmission(vec3 p, vec3 marchDir, float dt) {
  float height = abs(p.y);
  // Clamped to the escape sphere: past a merger uRs grows, and an unclamped
  // reach would put the jet's tip outside the volume the march ever visits.
  float reach = min(JET_LENGTH * uRs, R_ESCAPE);
  if (uJetStrength <= 0.0 || height < 0.5 * uRs || height > reach) return vec3(0.0);

  float radius = uRs * (JET_BASE_RADIUS + JET_OPENING * height / uRs);
  float rho = length(p.xz);
  if (rho > radius) return vec3(0.0);

  // Twist the sampling plane with height: braided filaments, no atan seam.
  float twist = height * JET_TWIST_RATE - uTime * JET_DRIFT_SPEED;
  float ct = cos(twist);
  float st = sin(twist);
  vec2 q = vec2(p.x * ct - p.z * st, p.x * st + p.z * ct);
  float filaments = fbm2(q * JET_NOISE_SCALE + vec2(0.0, height * 0.7));

  float axis = 1.0 - rho / radius; // 1 on the axis, 0 at the cone wall
  // The collimation region right above the horizon is the brightest part.
  float launch = 1.0 + 2.5 * exp(-height / (2.0 * uRs));
  float density = smoothstep(0.22, 0.80, filaments) * pow(axis, 1.3) * launch *
                  exp(-height / (JET_FADE * uRs));

  // Doppler beaming toward the observer, who lies along -marchDir.
  float gamma = inversesqrt(1.0 - JET_SPEED * JET_SPEED);
  float cosTheta = dot(vec3(0.0, sign(p.y), 0.0), -marchDir);
  float delta = 1.0 / (gamma * (1.0 - JET_SPEED * cosTheta));
  float beaming = clamp(pow(delta, BEAM_EXP), 0.05, 6.0);

  vec3 tint = mix(vec3(0.38, 0.60, 1.0), vec3(0.86, 0.94, 1.0), axis);
  return tint * density * beaming * uJetStrength * dt * JET_EMISSION;
}

// When a disruption dumps matter on the disc it goes super-Eddington, and
// radiation pressure drives a broad, ragged, un-collimated outflow, the wide
// red cones in every tidal-disruption illustration. Unlike the jet this is a
// thermal wind: slow, wide-angle, and not beamed. It only exists while the
// disc is actually being fed, so `uWindStrength` is driven by the feed itself.
const float WIND_REACH = 24.0;
const float WIND_FADE = 8.0;
/** Emission per unit march length, and it has to be small: at anything like
 *  the disc's scale the wind fills the whole frame with orange fog. */
const float WIND_EMISSION = 0.09;

vec3 windEmission(vec3 p, float dt) {
  if (uWindStrength <= 0.0) return vec3(0.0);
  float r = length(p);
  if (r < 2.0 * uRs || r > min(WIND_REACH * uRs, R_ESCAPE)) return vec3(0.0);

  // Bipolar cone: full strength on the axis, gone by roughly 45 degrees.
  float cone = smoothstep(0.72, 0.99, abs(p.y) / max(r, 1e-4));
  if (cone <= 0.0) return vec3(0.0);

  // Two octaves of drifting noise: ragged shells, not a smooth glow. Kept
  // cheap because this runs per march step for every ray inside the cone.
  vec3 q = p * 0.5 - vec3(0.0, sign(p.y) * uTime * 0.4, 0.0);
  float clumps = valueNoise3(q) * 0.65 + valueNoise3(q * 2.3 + 4.1) * 0.35;
  clumps = smoothstep(0.34, 0.85, clumps);

  float density = cone * exp(-r / (WIND_FADE * uRs)) * clumps;
  vec3 tint = mix(vec3(1.0, 0.18, 0.05), vec3(1.0, 0.58, 0.26), clumps);
  return tint * density * uWindStrength * dt * WIND_EMISSION;
}

// A body under tides is not an ellipsoid: it is drawn into a teardrop, a full
// bulb trailing away from the hole and a thin tip pulled toward it, which is
// the shape every image of a disruption shows. Signed field in unit local
// coordinates, negative inside. +y is the near-hole tip throughout this file.
const float TAIL_TAPER = 0.72;

float teardropField(vec3 local) {
  float y = clamp(local.y, -1.0, 1.0);
  float girth = sqrt(max(1.0 - y * y, 0.0)) * (1.0 - TAIL_TAPER * (0.5 + 0.5 * y));
  return length(local.xz) - girth;
}

vec3 teardropNormal(vec3 local) {
  const vec2 e = vec2(0.012, 0.0);
  vec3 gradient = vec3(
    teardropField(local + e.xyy) - teardropField(local - e.xyy),
    teardropField(local + e.yxy) - teardropField(local - e.yxy),
    teardropField(local + e.yyx) - teardropField(local - e.yyx));
  return normalize(uPlanetRot * (gradient / uPlanetRadii));
}

// The teardrop is not a quadric, so the bounding ellipsoid is solved
// analytically and the surface is found by a short march inside it, only for
// the handful of rays that reach the bounding volume at all.
bool hitPlanet(vec3 a, vec3 b, out vec3 pos, out vec3 nrm, out vec3 local, out float tHit) {
  vec3 la = uPlanetInvRot * (a - uPlanetPos) / uPlanetRadii;
  vec3 lb = uPlanetInvRot * (b - uPlanetPos) / uPlanetRadii;
  vec3 d = lb - la;
  float A = dot(d, d);
  if (A < 1e-12) return false;
  float B = 2.0 * dot(la, d);
  float C = dot(la, la) - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) return false;
  float root = sqrt(disc);
  float tEnter = max((-B - root) / (2.0 * A), 0.0);
  float tExit = min((-B + root) / (2.0 * A), 1.0);
  if (tExit <= tEnter) return false;

  vec3 entry = la + d * tEnter;
  if (teardropField(entry) < 0.0) {
    pos = mix(a, b, tEnter);
    local = entry; // unit-sphere coords: +y is the near-hole tip
    nrm = teardropNormal(entry);
    tHit = tEnter;
    return true;
  }

  float tPrev = tEnter;
  for (int i = 1; i <= 8; i++) {
    float t = mix(tEnter, tExit, float(i) / 8.0);
    if (teardropField(la + d * t) >= 0.0) {
      tPrev = t;
      continue;
    }
    // Straddled the surface: bisect to it.
    float outside = tPrev;
    float inside = t;
    for (int k = 0; k < 4; k++) {
      float mid = 0.5 * (outside + inside);
      if (teardropField(la + d * mid) < 0.0) inside = mid;
      else outside = mid;
    }
    vec3 lp = la + d * inside;
    pos = mix(a, b, inside);
    local = lp; // unit-sphere coords: +y is the near-hole tip
    nrm = teardropNormal(lp);
    tHit = inside;
    return true;
  }
  return false;
}

// A rocky body is lit by the disc's glow; a star lights itself. Tidal work is
// done hardest on the end nearest the hole, so a shredding star runs white-hot
// at the near-hole tip (+y) and deep orange at the trailing bulb, with
// convection granulation sheared along the stretch axis by the flow.
vec3 shadePlanet(vec3 pos, vec3 nrm, vec3 local) {
  vec3 toHole = normalize(-pos);
  float ndl = max(dot(nrm, toHole), 0.0);
  vec3 toCam = normalize(uCamPos - pos);
  float rim = pow(1.0 - abs(dot(nrm, toCam)), 3.0);

  vec3 col = uPlanetColor * (0.07 + ndl * vec3(1.1, 0.62, 0.34) * min(uDiscBrightness + 0.25, 2.0));
  col += uPlanetColor * rim * 0.15;
  if (uPlanetEmissive <= 0.0) return col;

  float grain = fbm3(local * vec3(7.0, 2.5, 7.0) + vec3(0.0, uTime * 0.4, 0.0));
  float heat = smoothstep(-0.9, 1.0, local.y) * 0.75 + 0.35 * grain;
  vec3 hot = mix(vec3(1.0, 0.38, 0.08), vec3(1.0, 0.94, 0.82), smoothstep(0.25, 0.95, heat));
  hot = mix(hot, vec3(0.86, 0.93, 1.0), smoothstep(0.95, 1.25, heat));
  col += hot * uPlanetEmissive * (0.40 + 1.0 * heat) * (0.75 + 0.5 * grain);
  col += hot * uPlanetEmissive * rim * 0.5; // limb flare
  return col;
}

// Corona hugging the body, measured by the same teardrop field the surface
// uses, so it tapers along the tail instead of ballooning around a fat
// ellipsoid. Optically thin: it glows, it never occludes.
const float CORONA_EMISSION = 0.05;

vec3 coronaEmission(vec3 p, float dt) {
  if (uPlanetActive == 0 || uPlanetEmissive <= 0.0) return vec3(0.0);
  float outside = max(teardropField(uPlanetInvRot * (p - uPlanetPos) / uPlanetRadii), 0.0);
  return uPlanetColor * uPlanetEmissive * CORONA_EMISSION * dt * exp(-outside * outside * 6.0);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy + uJitter) / uResolution * 2.0 - 1.0;
  vec3 x = uCamPos;
  vec3 v = normalize(uCamBasis * vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, -1.0));

  // Fast-forward a distant camera to the escape sphere; deflection out there
  // is negligible and the saved steps go to the photon ring instead.
  if (dot(x, x) > R_ESCAPE * R_ESCAPE) {
    float tca = dot(-x, v);
    float d2 = dot(x, x) - tca * tca;
    if (tca < 0.0 || d2 > R_ESCAPE * R_ESCAPE * 0.98) {
      gl_FragColor = vec4(textureCube(uSky, v).rgb, 1.0);
      return;
    }
    x += v * (tca - sqrt(R_ESCAPE * R_ESCAPE * 0.98 - d2));
  }

  vec3 col = vec3(0.0);
  float T = 1.0;
  bool captured = false;
  bool opaqueHit = false;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (isCaptured(x)) {
      captured = true;
      break;
    }
    if (dot(x, x) > R_ESCAPE * R_ESCAPE && dot(x, v) > 0.0) break;

    float dt = stepSizeAt(x);
    vec3 xPrev = x;
    vec3 vPrev = v;
    integrateStep(x, v, dt);

    // Order the two possible hits inside this segment by their parameter.
    float sDisc = 2.0;
    if (uDiscBrightness > 0.0 && xPrev.y * x.y < 0.0) {
      sDisc = xPrev.y / (xPrev.y - x.y);
      float rr = length(mix(xPrev, x, sDisc).xz);
      if (rr < uDiscInner || rr > uDiscOuter) sDisc = 2.0;
    }
    vec3 pPos;
    vec3 pNrm;
    vec3 pLocal;
    float sPlanet = 2.0;
    if (uPlanetActive == 1) {
      float t;
      if (hitPlanet(xPrev, x, pPos, pNrm, pLocal, t)) sPlanet = t;
    }

    // Volumetric, so these accumulate every step rather than at a crossing.
    vec3 mid = mix(xPrev, x, 0.5);
    col += T * jetEmission(mid, normalize(mix(vPrev, v, 0.5)), dt);
    col += T * windEmission(mid, dt);
    col += T * coronaEmission(mid, dt);

    if (sDisc < sPlanet) {
      vec4 e = discEmission(mix(xPrev, x, sDisc), normalize(mix(vPrev, v, sDisc)));
      col += T * e.rgb;
      T *= 1.0 - e.a;
    }
    if (sPlanet <= 1.0) {
      // Opaque: anything behind the planet in this segment is hidden.
      col += T * shadePlanet(pPos, pNrm, pLocal);
      T = 0.0;
      opaqueHit = true;
      break;
    }
    if (T < 0.01) break;
  }

  if (!captured && !opaqueHit && T > 0.001) {
    col += T * textureCube(uSky, normalize(v)).rgb;
  }
  gl_FragColor = vec4(col, captured ? 0.0 : 1.0);
}
