// Dual-filter Kawase downsample.

uniform sampler2D tSrc;
uniform vec2 uOutRes;
uniform vec2 uHalfPixel; // half-pixel of the SOURCE texture

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 sum = texture2D(tSrc, uv).rgb * 4.0;
  sum += texture2D(tSrc, uv - uHalfPixel).rgb;
  sum += texture2D(tSrc, uv + uHalfPixel).rgb;
  sum += texture2D(tSrc, uv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  sum += texture2D(tSrc, uv - vec2(uHalfPixel.x, -uHalfPixel.y)).rgb;
  gl_FragColor = vec4(sum / 8.0, 1.0);
}
