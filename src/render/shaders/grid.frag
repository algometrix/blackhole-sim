// Spacetime wireframe: cyan lines that brighten on wave crests, fade out at
// the rim, and are occluded by the event horizon like every overlay object.

#include ./horizonMask.glsl;

uniform vec3 uColor;
uniform float uOpacity;
uniform float uFadeStart;
uniform float uFadeEnd;

/** Ripple height at which a crest is fully lit, and how much brighter than the
 *  flat grid it gets there. Strain falls as 1/r, so without a steep response
 *  the outer crests are invisible. */
const float CREST_FULL_AT = 1.0 / 7.0;
const float CREST_GAIN = 1.6;

varying float vRipple;
varying vec3 vWorldPos;

void main() {
  float r = length(vWorldPos.xz);
  float rim = 1.0 - smoothstep(uFadeStart, uFadeEnd, r);
  float crest = clamp(abs(vRipple) / CREST_FULL_AT, 0.0, 1.0);
  float alpha = uOpacity * rim * horizonVisibility(vWorldPos);
  if (alpha < 0.004) discard;
  vec3 col = mix(uColor, vec3(0.80, 0.96, 1.0), crest) * (0.7 + CREST_GAIN * crest);
  gl_FragColor = vec4(col * alpha, alpha);
}
