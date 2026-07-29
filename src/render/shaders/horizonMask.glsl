// Horizon occlusion for overlay (non-raymarched) objects: the BH pass writes
// alpha = 0 where the camera ray fell into the hole, so any overlay fragment
// that lies beyond the hole on such a pixel is hidden, with a soft edge from
// bilinear sampling of the (possibly half-res) mask.

uniform sampler2D uMaskTex;
uniform vec2 uScreenRes;
uniform vec3 uCamPosW;

float horizonVisibility(vec3 worldPos) {
  float mask = texture2D(uMaskTex, gl_FragCoord.xy / uScreenRes).a;
  float distFrag = length(worldPos - uCamPosW);
  float distHole = length(uCamPosW);
  float behind = step(distHole - 1.0, distFrag);
  return mix(1.0, smoothstep(0.05, 0.6, mask), behind);
}
