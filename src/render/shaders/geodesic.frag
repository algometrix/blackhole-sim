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

// Segment-vs-ellipsoid intersection in the planet's local frame.
bool hitPlanet(vec3 a, vec3 b, out vec3 pos, out vec3 nrm, out float tHit) {
  vec3 la = uPlanetInvRot * (a - uPlanetPos) / uPlanetRadii;
  vec3 lb = uPlanetInvRot * (b - uPlanetPos) / uPlanetRadii;
  vec3 d = lb - la;
  float A = dot(d, d);
  if (A < 1e-12) return false;
  float B = 2.0 * dot(la, d);
  float C = dot(la, la) - 1.0;
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) return false;
  float t = (-B - sqrt(disc)) / (2.0 * A);
  if (t < 0.0 || t > 1.0) return false;
  vec3 lp = la + d * t;
  pos = mix(a, b, t);
  nrm = normalize(uPlanetRot * (lp / uPlanetRadii));
  tHit = t;
  return true;
}

vec3 shadePlanet(vec3 pos, vec3 nrm) {
  // Lit by the disc's glow surrounding the hole; warm key light.
  vec3 toHole = normalize(-pos);
  float ndl = max(dot(nrm, toHole), 0.0);
  vec3 toCam = normalize(uCamPos - pos);
  float rim = pow(1.0 - abs(dot(nrm, toCam)), 3.0);
  vec3 col = uPlanetColor * (0.07 + ndl * vec3(1.1, 0.62, 0.34) * min(uDiscBrightness + 0.25, 2.0));
  col += uPlanetColor * rim * 0.15;
  col += uPlanetColor * uPlanetEmissive;
  return col;
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
    float sPlanet = 2.0;
    if (uPlanetActive == 1) {
      float t;
      if (hitPlanet(xPrev, x, pPos, pNrm, t)) sPlanet = t;
    }

    if (sDisc < sPlanet) {
      vec4 e = discEmission(mix(xPrev, x, sDisc), normalize(mix(vPrev, v, sDisc)));
      col += T * e.rgb;
      T *= 1.0 - e.a;
    }
    if (sPlanet <= 1.0) {
      // Opaque: anything behind the planet in this segment is hidden.
      col += T * shadePlanet(pPos, pNrm);
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
