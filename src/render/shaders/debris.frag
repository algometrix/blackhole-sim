// Soft additive debris sprite with a heat-driven color ramp, occluded by the
// event horizon via the BH pass's alpha mask.

#include ./horizonMask.glsl;

uniform float uBrightness;

varying float vHeat;
varying float vLife;
varying vec3 vWorldPos;

vec3 heatRamp(float t) {
  vec3 c = mix(vec3(0.35, 0.03, 0.0), vec3(1.0, 0.42, 0.1), smoothstep(0.0, 0.5, t));
  return mix(c, vec3(1.0, 0.93, 0.8), smoothstep(0.5, 1.0, t));
}

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float sprite = exp(-d * d * 4.5) * smoothstep(1.0, 0.65, d);
  float a = sprite * clamp(vLife, 0.0, 1.0) * horizonVisibility(vWorldPos);
  if (a < 0.002) discard;
  vec3 col = heatRamp(vHeat) * (0.6 + 5.0 * vHeat * vHeat) * uBrightness;
  gl_FragColor = vec4(col * a, a);
}
