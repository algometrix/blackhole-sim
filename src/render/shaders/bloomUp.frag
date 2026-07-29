// Dual-filter Kawase upsample (tent), plus the same-size downsample chain
// texture so the bloom accumulates across mip levels.

uniform sampler2D tSrc; // smaller level being upsampled
uniform sampler2D tAdd; // same-size level from the down chain
uniform vec2 uOutRes;
uniform vec2 uHalfPixel; // half-pixel of the SOURCE texture

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec3 sum = texture2D(tSrc, uv + vec2(-uHalfPixel.x * 2.0, 0.0)).rgb;
  sum += texture2D(tSrc, uv + vec2(-uHalfPixel.x, uHalfPixel.y)).rgb * 2.0;
  sum += texture2D(tSrc, uv + vec2(0.0, uHalfPixel.y * 2.0)).rgb;
  sum += texture2D(tSrc, uv + vec2(uHalfPixel.x, uHalfPixel.y)).rgb * 2.0;
  sum += texture2D(tSrc, uv + vec2(uHalfPixel.x * 2.0, 0.0)).rgb;
  sum += texture2D(tSrc, uv + vec2(uHalfPixel.x, -uHalfPixel.y)).rgb * 2.0;
  sum += texture2D(tSrc, uv + vec2(0.0, -uHalfPixel.y * 2.0)).rgb;
  sum += texture2D(tSrc, uv + vec2(-uHalfPixel.x, -uHalfPixel.y)).rgb * 2.0;
  gl_FragColor = vec4(sum / 12.0 + texture2D(tAdd, uv).rgb, 1.0);
}
