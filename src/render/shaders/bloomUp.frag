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
  // Blend the coarser level into this one instead of summing it: with six
  // levels a straight sum multiplies the total bloom energy by the level count
  // and washes the frame out. A lerp keeps the energy of a single level while
  // still inheriting the wide, smooth tail that hides the kernel's shape.
  gl_FragColor = vec4(mix(texture2D(tAdd, uv).rgb, sum / 12.0, 0.6), 1.0);
}
