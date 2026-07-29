// Procedural starfield, rendered once onto the faces of a cubemap at boot.
// Three grid layers of gaussian point stars plus a faint tilted nebula band.

#include ./noise.glsl;

uniform float uSeed;

varying vec3 vWorldPos;

vec3 starLayer(vec3 dir, float scale, float density, float brightScale) {
  vec3 p = dir * scale;
  vec3 base = floor(p - 0.5);
  vec3 col = vec3(0.0);
  for (int ix = 0; ix <= 1; ix++)
    for (int iy = 0; iy <= 1; iy++)
      for (int iz = 0; iz <= 1; iz++) {
        vec3 id = base + vec3(float(ix), float(iy), float(iz));
        vec3 h = hash33(id + uSeed);
        if (h.x > density) continue;
        vec3 starPos = id + 0.2 + h * 0.6;
        float d = length(p - starPos);
        float b = pow(hash13(id + 17.31 + uSeed), 9.0) * brightScale + 0.02;
        float tt = hash13(id + 29.7 + uSeed);
        vec3 tint = mix(vec3(1.0, 0.72, 0.55), vec3(0.68, 0.78, 1.0), tt);
        tint = mix(tint, vec3(1.0, 0.96, 0.9), 0.5);
        col += tint * b * exp(-d * d * 220.0);
      }
  return col;
}

void main() {
  vec3 dir = normalize(vWorldPos);
  vec3 col = starLayer(dir, 22.0, 0.22, 4.0) +
             starLayer(dir, 51.0, 0.18, 1.5) +
             starLayer(dir, 113.0, 0.15, 0.6);

  // Faint tilted "milky way" band with fbm structure.
  vec3 bandNormal = normalize(vec3(0.35, 1.0, 0.18));
  float band = exp(-pow(dot(dir, bandNormal), 2.0) * 14.0);
  float neb = fbm3(dir * 4.0 + 7.3);
  float dust = fbm3(dir * 9.0 - 3.1);
  col += band * (0.010 + 0.055 * neb) * vec3(0.55, 0.62, 0.95);
  col += band * 0.028 * dust * vec3(0.9, 0.62, 0.5);

  gl_FragColor = vec4(col, 1.0);
}
