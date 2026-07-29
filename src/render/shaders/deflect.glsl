// Approximate weak-field lensing for overlay objects: shift the APPARENT
// position of a vertex away from the hole by the deflection angle 2/b of its
// sightline, faded out for wide passes. Rough, but makes debris visually
// "grab" toward the lensed background consistently.

vec3 deflectApparent(vec3 worldPos, vec3 camPos) {
  vec3 rel = worldPos - camPos;
  float dist = length(rel);
  vec3 dir = rel / max(dist, 1e-5);
  float tca = dot(-camPos, dir);
  if (tca <= 0.0 || dist <= tca) return worldPos;
  vec3 closest = camPos + dir * tca;
  float b = length(closest);
  if (b < 0.6) return worldPos;
  float alpha = (2.0 / max(b, 2.2)) * smoothstep(8.0, 3.0, b);
  if (alpha < 1e-4) return worldPos;
  vec3 outward = normalize(closest);
  vec3 bent = normalize(dir * cos(alpha) + outward * sin(alpha));
  return camPos + bent * dist;
}
