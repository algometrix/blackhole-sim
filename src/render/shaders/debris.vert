// Debris point sprites: distance-attenuated size, approximate lensing warp
// of the apparent position, heat/life passed through to the fragment stage.

#include ./deflect.glsl;

attribute float aHeat;
attribute float aLife;
attribute float aSize;

uniform float uPixelScale; // pixels per world unit at unit view depth

varying float vHeat;
varying float vLife;
varying vec3 vWorldPos;

void main() {
  vHeat = aHeat;
  vLife = aLife;
  vWorldPos = position; // debris positions are authored in world space
  vec3 apparent = deflectApparent(position, cameraPosition);
  vec4 mv = viewMatrix * vec4(apparent, 1.0);
  gl_PointSize = clamp(aSize * uPixelScale / max(-mv.z, 0.1), 1.0, 64.0);
  gl_Position = projectionMatrix * mv;
}
