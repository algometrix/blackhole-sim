// Bloom prefilter: keep only HDR energy above the threshold.

uniform sampler2D tSrc;
uniform vec2 uOutRes;
uniform float uThreshold;

/**
 * Ceiling on what may enter the blur chain. A relativistically beamed disc
 * sample can reach a few thousand; once the downsample chain sums those in a
 * half-float target it overflows to Inf, and Inf spread by the tent upsample
 * turns into NaN, which the tonemap then renders as flat black polygons
 * around the brightest parts of the image.
 */
const float BLOOM_CEILING = 32.0;

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 c = min(texture2D(tSrc, uv).rgb, vec3(BLOOM_CEILING));
  float l = max(max(c.r, c.g), c.b);
  if (!(l < BLOOM_CEILING + 1.0)) { // NaN in, black hole out, literally
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}
