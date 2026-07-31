// Procedural deep sky, rendered once onto the faces of a cubemap at boot:
// a warped galactic band with dust lanes and extinction, multi-hue emission
// nebulae, five layers of stars (the bright ones get diffraction spikes),
// globular clusters and a few distant galaxies.
//
// The geodesic shader samples this along each escaped ray's bent direction,
// so every feature here is lensed into arcs near the shadow for free. The
// palette is deliberately art-directed (wallpaper, not a survey plate):
// magenta hydrogen, teal oxygen, gold core, with a slow hue wash across the
// whole sphere so no two parts of the sky read the same.

#include ./noise.glsl;

uniform float uSeed;
uniform float uStarDensity;
uniform float uStarBrightness;
uniform float uNebulaIntensity;
uniform float uDeepSkyIntensity;

varying vec3 vWorldPos;

#define GALAXY_COUNT 16
#define CLUSTER_COUNT 6
#define TAU 6.2831853

// Galactic plane orientation and an in-plane direction for the core bulge.
// Precomputed because GLSL const initializers must be constant expressions:
// GALACTIC_NORMAL = normalize(vec3(0.35, 1.0, 0.18)), GALACTIC_CORE is the
// part of +X perpendicular to it.
const vec3 GALACTIC_NORMAL = vec3(0.3257, 0.9305, 0.1675);
const vec3 GALACTIC_CORE = vec3(0.9455, -0.3205, -0.0577);

// Value noise lives on a cubic lattice, and a cubemap face is axis-aligned
// with it: sampled straight, the cells line up into visible angular patches.
// Every noise lookup is rotated by this fixed frame so the lattice never
// agrees with the faces (or with the other layers, which use its powers).
const mat3 NOISE_ROT = mat3(
  0.80, 0.60, 0.00,
 -0.36, 0.48, 0.80,
  0.48, -0.64, 0.60);

struct StarLayer {
  float cellScale;  // grid cells per unit direction: larger = finer, fainter, more distant
  float density;    // fraction of cells holding a star
  float brightness; // peak brightness of this layer's brightest stars
  float sharpness;  // gaussian core falloff
  float spikes;     // diffraction-spike strength (0 for the far layers)
};

/** Dust does two things at once: it glows, and it hides what lies behind it. */
struct Medium {
  vec3 glow;
  float extinction; // multiplier for light arriving from behind the dust
};

/** Clusters both add unresolved glow and crowd extra stars into their core. */
struct ClusterField {
  vec3 glow;
  float densityBoost;
};

/** Uniformly distributed direction from two hash values (never degenerate). */
vec3 directionFromHash(vec2 h) {
  float z = h.x * 2.0 - 1.0;
  float phi = h.y * TAU;
  float r = sqrt(max(1.0 - z * z, 0.0));
  return vec3(r * cos(phi), z, r * sin(phi));
}

/** World-fixed tangent frame, so spikes and galaxy discs stay consistent
 *  across cube faces instead of pivoting per face. */
void tangentFrame(vec3 dir, out vec3 e1, out vec3 e2) {
  vec3 up = abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  e1 = normalize(cross(up, dir));
  e2 = cross(dir, e1);
}

/** Stellar color from a temperature draw: cool orange dwarfs through the
 *  white middle of the main sequence to rare blue-white giants. */
vec3 starTint(float temperature) {
  vec3 c = mix(vec3(1.0, 0.52, 0.32), vec3(1.0, 0.84, 0.62), smoothstep(0.0, 0.45, temperature));
  c = mix(c, vec3(1.0, 0.98, 0.96), smoothstep(0.40, 0.76, temperature));
  c = mix(c, vec3(0.66, 0.80, 1.0), smoothstep(0.74, 1.0, temperature));
  return c;
}

// One cubic grid of stars, sampled over the 2x2x2 cells around the view
// direction. `clustering` scales how many cells fire, so the galactic plane
// and globular cluster cores can crowd stars together.
vec3 starLayer(StarLayer layer, vec3 dir, float clustering) {
  vec3 p = dir * layer.cellScale;
  vec3 base = floor(p - 0.5);
  vec3 e1, e2;
  tangentFrame(dir, e1, e2);

  vec3 col = vec3(0.0);
  for (int ix = 0; ix <= 1; ix++)
    for (int iy = 0; iy <= 1; iy++)
      for (int iz = 0; iz <= 1; iz++) {
        vec3 id = base + vec3(float(ix), float(iy), float(iz));
        vec3 h = hash33(id + uSeed);
        if (h.x > layer.density * clustering) continue;

        vec3 delta = p - (id + 0.2 + h * 0.6);
        float d2 = dot(delta, delta);
        if (d2 > 0.3) continue; // outside this star's footprint entirely

        // Luminosity function: faint stars vastly outnumber bright ones, and
        // the hot end of the main sequence is the bright end.
        float magnitude = pow(hash13(id + 17.31 + uSeed), 9.0);
        float temperature = hash13(id + 29.7 + uSeed);
        float flux = (magnitude * mix(0.55, 1.9, temperature) * layer.brightness + 0.015) *
                     uStarBrightness;

        // Core plus a wide faint halo: the halo is what survives minification
        // and keeps the field from scintillating when the lensing stretches it.
        float glow = exp(-d2 * layer.sharpness) + 0.06 * exp(-d2 * 22.0);

        if (layer.spikes > 0.0) {
          vec2 q = vec2(dot(delta, e1), dot(delta, e2));
          float spike = exp(-abs(q.x) * 7.0 - q.y * q.y * 1600.0) +
                        exp(-abs(q.y) * 7.0 - q.x * q.x * 1600.0);
          glow += spike * layer.spikes * smoothstep(0.25, 0.75, magnitude) * 0.30;
        }
        col += starTint(temperature) * flux * glow;
      }
  return col;
}

/** The galactic band: a great circle around the plane whose center line is
 *  warped by low-frequency noise, so it never reads as a perfect ring. */
float galacticBand(vec3 dir) {
  vec3 n = NOISE_ROT * dir;
  float height = dot(dir, GALACTIC_NORMAL) + 0.06 * (valueNoise3(n * 2.2 + 11.0) - 0.5);
  return exp(-height * height * 13.0);
}

/** A slow hue wash over the whole sphere: one side drifts violet, the other
 *  teal. Deliberately near-black, deep-field plates are black except where
 *  something is actually emitting, and gamma lifts even 0.01 into a haze. */
vec3 skyWash(vec3 dir) {
  float t = valueNoise3(NOISE_ROT * dir * 1.1 + 3.9);
  vec3 violet = vec3(0.0040, 0.0030, 0.0095);
  vec3 teal = vec3(0.0012, 0.0050, 0.0072);
  return mix(violet, teal, smoothstep(0.25, 0.75, t));
}

// Interstellar medium along the band: unresolved starlight, a reddened core
// bulge, dust that both scatters and blocks, and sparse emission regions
// (hydrogen magenta, doubly ionised oxygen teal, dusty reflection gold).
Medium interstellarMedium(vec3 dir, float band) {
  vec3 n = NOISE_ROT * dir;
  // Domain warp: straight fbm reads as cotton wool, warped fbm reads as gas.
  vec3 warp = vec3(valueNoise3(n * 2.0 + 5.0),
                   valueNoise3(n * 2.0 + 9.0),
                   valueNoise3(n * 2.0 + 13.0)) - 0.5;
  float cloud = fbm3(n * 3.6 + warp * 1.6 + 7.3);
  float fine = fbm3(n * 11.0 - 3.1);
  float core = pow(max(dot(dir, GALACTIC_CORE), 0.0), 6.0);
  // Filaments: the same cloud pushed to high contrast, so emission sits in
  // wisps and shells instead of an even fog.
  float filament = smoothstep(0.34, 0.80, cloud);

  // Dust lanes: the dark rifts that split the band lengthwise. The ramp stays
  // wide on purpose, a tight one turns the lattice of the underlying noise
  // into hard-edged black patches.
  float dust = smoothstep(0.30, 0.85, fbm3(n * 5.0 + 23.0) * 0.7 + fine * 0.5);
  float extinction = 1.0 - 0.6 * band * dust * (0.55 + 0.45 * core);

  // The band's unresolved starlight shifts hue along its length: violet on
  // one side, teal on the other, gold through the bulge.
  vec3 bandTint = mix(vec3(0.45, 0.48, 1.0), vec3(0.30, 0.75, 0.95),
                      smoothstep(0.3, 0.7, valueNoise3(n * 1.6 - 4.4)));
  vec3 glow = band * (0.010 + 0.060 * cloud) * bandTint;
  glow += band * core * 0.13 * vec3(1.0, 0.76, 0.48);
  glow += band * 0.030 * fine * vec3(0.95, 0.55, 0.75);
  glow *= extinction; // the band's own light is dimmed by the dust in front of it

  // Emission regions: masked to sparse patches, then structured by the same
  // warped cloud field so they sit inside the gas rather than on top of it.
  float region = smoothstep(0.54, 0.84, fbm3(n * 1.5 + 41.0));
  float hydrogen = region * (0.25 + 0.75 * band) * filament;
  float oxygen = smoothstep(0.58, 0.90, fbm3(n * 2.6 - 27.0)) * (0.22 + 0.78 * band) * cloud;
  float reflection = region * band * smoothstep(0.45, 0.85, fine);

  glow += hydrogen * 0.34 * vec3(1.0, 0.17, 0.52);
  glow += oxygen * 0.20 * vec3(0.16, 0.85, 0.80);
  glow += reflection * 0.09 * vec3(1.0, 0.72, 0.42);

  return Medium(glow * uNebulaIntensity, mix(1.0, extinction, clamp(uNebulaIntensity, 0.0, 1.0)));
}

// Globular clusters: an unresolved core glow plus a sharp local spike in star
// density, so the fine layers resolve individual members near the center.
ClusterField globularClusters(vec3 dir) {
  ClusterField field = ClusterField(vec3(0.0), 0.0);
  for (int i = 0; i < CLUSTER_COUNT; i++) {
    vec3 h = hash33(vec3(float(i) * 4.1 + 2.7) + uSeed);
    vec3 center = directionFromHash(h.xy);
    float cosAngle = dot(dir, center);
    if (cosAngle < 0.995) continue;

    float extent = mix(0.012, 0.030, h.z);
    float r = length(dir - center * cosAngle) / extent;
    field.glow += vec3(1.0, 0.93, 0.80) * exp(-r * r * 0.8) * 0.06 * uDeepSkyIntensity;
    field.densityBoost += 6.0 * exp(-r * r * 0.5);
  }
  return field;
}

// Distant galaxies, deep-field style: mostly small warm ellipticals with a
// few larger inclined spirals whose dust lane cuts the disc in half (the
// edge-on look of Hubble's NGC plates). Small on the sky, but the lensing
// near the photon ring stretches them into arcs, which is the point.
vec3 distantGalaxies(vec3 dir) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < GALAXY_COUNT; i++) {
    vec3 h = hash33(vec3(float(i) * 7.3 + 1.9) + uSeed);
    vec3 center = directionFromHash(h.xy);
    float cosAngle = dot(dir, center);
    if (cosAngle < 0.99) continue;

    vec3 e1, e2;
    tangentFrame(center, e1, e2);
    vec3 offset = dir - center * cosAngle;
    float roll = h.z * TAU;
    float ca = cos(roll);
    float sa = sin(roll);
    vec2 local = vec2(dot(offset, e1), dot(offset, e2));
    local = vec2(ca * local.x + sa * local.y, -sa * local.x + ca * local.y);

    vec3 g = hash33(vec3(float(i) * 2.3 + 11.0) + uSeed);
    float inclination = mix(0.14, 1.0, g.x); // 1 = face-on, small = edge-on
    float extent = mix(0.006, 0.026, g.y * g.y); // a few big ones, many small
    vec2 disc = vec2(local.x, local.y / inclination) / extent;
    float r = length(disc);
    if (r > 4.0) continue;
    float angle = atan(disc.y, disc.x + 1e-6);

    // Spiral arms for the face-on ones; a dark lane across the edge-on ones.
    float arms = 0.55 + 0.45 * cos(2.0 * (angle + r * 3.2));
    float lane = 1.0 - 0.7 * (1.0 - inclination) * exp(-pow(disc.y * 1.6, 2.0)) *
                 smoothstep(0.2, 0.9, r);
    float profile = exp(-r * 5.0) * 1.5 + exp(-r * 1.9) * arms * lane * 0.6;

    // Ellipticals run warm and old, spirals run blue toward their arms.
    vec3 nucleus = mix(vec3(1.0, 0.80, 0.52), vec3(1.0, 0.92, 0.80), g.z);
    vec3 halo = mix(vec3(1.0, 0.72, 0.45), vec3(0.60, 0.74, 1.0), smoothstep(0.2, 0.8, g.x));
    col += mix(nucleus, halo, smoothstep(0.1, 1.4, r)) * profile * mix(0.03, 0.10, g.z);
  }
  return col * uDeepSkyIntensity;
}

void main() {
  vec3 dir = normalize(vWorldPos);

  float band = galacticBand(dir);
  Medium medium = interstellarMedium(dir, band);
  ClusterField clusters = globularClusters(dir);

  // Stars crowd into the galactic plane and into cluster cores.
  float clustering = (1.0 + 2.2 * band + clusters.densityBoost) * uStarDensity;

  StarLayer giants = StarLayer(24.0, 0.22, 4.2, 260.0, 1.0);
  StarLayer nearField = StarLayer(52.0, 0.24, 1.9, 250.0, 0.35);
  StarLayer midField = StarLayer(112.0, 0.26, 0.90, 240.0, 0.0);
  StarLayer farField = StarLayer(190.0, 0.28, 0.45, 230.0, 0.0);
  StarLayer faintSea = StarLayer(310.0, 0.30, 0.22, 220.0, 0.0);

  // Nearby stars sit mostly in front of the dust; the faint sea is all behind it.
  vec3 col = starLayer(giants, dir, clustering) * mix(1.0, medium.extinction, 0.35);
  col += starLayer(nearField, dir, clustering) * mix(1.0, medium.extinction, 0.7);
  col += (starLayer(midField, dir, clustering) +
          starLayer(farField, dir, clustering) +
          starLayer(faintSea, dir, clustering)) * medium.extinction;

  col += medium.glow;
  col += clusters.glow * medium.extinction;
  col += distantGalaxies(dir) * medium.extinction;
  col += skyWash(dir) * uNebulaIntensity * medium.extinction;

  gl_FragColor = vec4(col, 1.0);
}
