// HDR combine: upsampled raymarch output plus the full-res overlay scene.

uniform sampler2D tBH;
uniform sampler2D tScene;
uniform vec2 uOutRes;

void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  gl_FragColor = vec4(texture2D(tBH, uv).rgb + texture2D(tScene, uv).rgb, 1.0);
}
