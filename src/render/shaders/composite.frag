// Final composite: HDR + bloom, ACES filmic tonemap, gamma, dither.

#include ./noise.glsl;

uniform sampler2D tHDR;
uniform sampler2D tBloom;
uniform vec2 uOutRes;
uniform float uBloomStrength;
uniform float uFade;

vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 hdr = texture2D(tHDR, uv).rgb + uBloomStrength * texture2D(tBloom, uv).rgb;

  // Subtle vignette keeps the frame cinematic without crushing the stars.
  vec2 v = uv * 2.0 - 1.0;
  hdr *= 1.0 - 0.22 * pow(length(v * vec2(1.0, 0.85)), 3.0);

  vec3 c = pow(acesFilm(hdr), vec3(1.0 / 2.2));
  c *= uFade;
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
