// Flamm's paraboloid, the exact Schwarzschild embedding diagram, drawn as a
// polar wireframe below the disc plane, plus the binary's quadrupole
// gravitational wave rippling across it.
//
// The surface satisfies z(r) = 2*sqrt(rs*(r - rs)); it is shifted so the outer
// rim sits at y = 0 and negated so the funnel descends toward the throat.

uniform float uRs;
uniform float uRimDepth;   // z(rOuter), the shift that puts the rim at y = 0
uniform float uDepthScale; // vertical exaggeration of the funnel
uniform float uWaveAmp;    // 0 whenever nothing is radiating
uniform float uWaveNumber; // radial wavenumber of the outgoing wave
uniform float uWavePhase;  // twice the orbital phase, accumulated

varying float vRipple;
varying vec3 vWorldPos;

void main() {
  float r = length(position.xz);
  float depth = 2.0 * sqrt(max(uRs * (r - uRs), 0.0));
  float y = -(uRimDepth - depth) * uDepthScale;

  // Quadrupole radiation: two crests per turn, wound into the trailing spiral
  // by the retarded phase, with the 1/r falloff of a real strain amplitude.
  float phi = atan(position.z, position.x + 1e-6);
  float ripple = uWaveAmp * sin(2.0 * phi - uWavePhase + uWaveNumber * r) / max(r, 1.5);
  y += ripple;

  vec4 world = modelMatrix * vec4(position.x, y, position.z, 1.0);
  vWorldPos = world.xyz;
  vRipple = ripple;
  gl_Position = projectionMatrix * viewMatrix * world;
}
