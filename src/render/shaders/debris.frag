// Soft additive debris sprite with a heat-driven color ramp, occluded by the
// event horizon via the BH pass's alpha mask.

#include ./horizonMask.glsl;

uniform float uBrightness;

varying float vHeat;
varying float vLife;
varying vec3 vWorldPos;

// The far end of a tidal stream is cool, dim and deep crimson; it heats
// through red and gold into white as it falls, which is the colour gradient
// every observed disruption image shows along the ribbon.
vec3 heatRamp(float t) {
  vec3 c = mix(vec3(0.42, 0.05, 0.10), vec3(0.98, 0.22, 0.07), smoothstep(0.0, 0.34, t));
  c = mix(c, vec3(1.0, 0.52, 0.14), smoothstep(0.30, 0.62, t));
  return mix(c, vec3(1.0, 0.93, 0.82), smoothstep(0.62, 1.0, t));
}

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // Tight core plus a wide dim skirt: overlapping skirts fuse thousands of
  // particles into one continuous glowing ribbon with a diffuse halo, instead
  // of reading as a dotted line.
  float sprite = (exp(-d * d * 9.0) + 0.22 * exp(-d * d * 1.6)) * smoothstep(1.0, 0.55, d);
  float a = sprite * clamp(vLife, 0.0, 1.0) * horizonVisibility(vWorldPos);
  if (a < 0.002) discard;
  vec3 col = heatRamp(vHeat) * (0.6 + 5.0 * vHeat * vHeat) * uBrightness;
  gl_FragColor = vec4(col * a, a);
}
