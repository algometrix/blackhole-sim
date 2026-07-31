// The infalling probe, drawn as a single point sprite in the overlay pass.
//
// The world position arriving here is already the position the *image*
// appears at (sim/beacon.ts apparentImageRadius has floored it at the photon
// ring), so this stage does no optics: it sizes the sprite on screen and
// hands the world position to the fragment stage for horizon occlusion.

uniform float uPixelScale;   // pixels per world unit at unit view depth
uniform float uWorldRadius;  // drawn radius in world units
uniform float uMinPixels;    // screen-space floor, see beaconPoint.ts

varying vec3 vWorldPos;

void main() {
  vWorldPos = position;
  vec4 mv = viewMatrix * vec4(position, 1.0);
  float projected = uWorldRadius * uPixelScale / max(-mv.z, 0.1);
  gl_PointSize = clamp(max(projected, uMinPixels), 1.0, 128.0);
  gl_Position = projectionMatrix * mv;
}
