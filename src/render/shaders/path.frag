// Glowing photon-path tube: additive HDR color with a soft core-to-edge
// falloff, hidden behind the event horizon by the mask.

#include ./horizonMask.glsl;

uniform vec3 uColor;

varying vec3 vWorldPos;
varying vec3 vNormalW;

void main() {
  vec3 toCam = normalize(uCamPosW - vWorldPos);
  float core = pow(abs(dot(vNormalW, toCam)), 1.5); // bright core, soft edge
  float vis = horizonVisibility(vWorldPos);
  gl_FragColor = vec4(uColor * (0.35 + 0.85 * core) * vis, 1.0);
}
