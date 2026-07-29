// Bloom prefilter: keep only HDR energy above the threshold.

uniform sampler2D tSrc;
uniform vec2 uOutRes;
uniform float uThreshold;

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 c = texture2D(tSrc, uv).rgb;
  float l = max(max(c.r, c.g), c.b);
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}
