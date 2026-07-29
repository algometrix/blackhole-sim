// Progressive temporal accumulation while the camera is idle: running average
// of jittered raymarch frames, converging to a supersampled image.

uniform sampler2D tCur;
uniform sampler2D tPrev;
uniform vec2 uOutRes;
uniform float uBlend; // 1/(frameCount+1)

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  vec4 cur = texture2D(tCur, uv);
  vec4 prev = texture2D(tPrev, uv);
  gl_FragColor = mix(prev, cur, uBlend);
}
