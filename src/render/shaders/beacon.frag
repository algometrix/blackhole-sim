// The infalling probe's lamp. One number does all the work: uShift is the
// received/emitted frequency ratio g computed in sim/beacon.ts, and it drives
// both the colour (by moving the blackbody temperature) and the brightness (by
// the same power law the disc dims on). Everything else here is art direction,
// and is labelled as such.

#include ./horizonMask.glsl;

uniform float uShift;      // g = received / emitted frequency
uniform float uBrightness; // exposure * emission scale

varying vec3 vWorldPos;

// Intrinsic colour temperature of the lamp, in the same arbitrary units the
// blackbody ramp below takes: blue-white unshifted, white near g = 0.7, orange
// near 0.33, deep red near 0.15. Art-directed choice of what the probe is;
// the shift that reddens it is not.
const float BEACON_TEMP = 1.35;

// The same exponent as BEAM_EXP in render/blackHolePass.ts, so the probe and
// the disc dim on one law. The honest bolometric value for a moving blackbody
// is 4; this app uses 3 throughout and docs/THEORY.md says so.
const float BEACON_BEAM_EXP = 3.0;

// The disc's ramp, kept in step with the copy in geodesic.frag by hand: red
// through gold to white to blue-white.
vec3 blackbody(float t) {
  vec3 c = mix(vec3(0.55, 0.04, 0.0), vec3(1.0, 0.45, 0.12), smoothstep(0.0, 0.45, t));
  c = mix(c, vec3(1.0, 0.93, 0.82), smoothstep(0.45, 0.95, t));
  c = mix(c, vec3(0.72, 0.82, 1.0), smoothstep(0.95, 1.7, t));
  return c;
}

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // Tight core plus a dim skirt, so the probe still reads as a light source
  // rather than a hard dot once it is only a few pixels across.
  float sprite = (exp(-d * d * 10.0) + 0.18 * exp(-d * d * 1.8)) * smoothstep(1.0, 0.6, d);
  float a = sprite * horizonVisibility(vWorldPos);
  if (a < 0.002) discard;
  // Additive, not opaque. The probe is a lamp, so it belongs in the light it
  // adds and not in the light it blocks; an opaque version would end the fall
  // as a dark speck punched through the photon ring, which is what a cold
  // solid would do but reads as an artifact.
  vec3 col = blackbody(BEACON_TEMP * uShift) * uBrightness * pow(uShift, BEACON_BEAM_EXP);
  gl_FragColor = vec4(col * a, a);
}
