// Kerr in Cartesian Kerr-Schild form: the field, its analytic derivatives,
// the null launch, and the disc's orbital kinematics.
//
// This file is the GPU half of physics/geodesic.ts and physics/kerr.ts. The
// variable names and the order of the lines are deliberately identical to the
// TypeScript so a side-by-side diff is a readable review: there is no headless
// GL in this project, so that diff is the whole verification strategy for the
// shader. If one side is edited the other has to be edited with it, or the
// drawn photon paths stop landing on the rendered photon ring and nothing
// fails a test.
//
// Nothing here reads a uniform. Spin arrives as `a` (length units, a = spin*M)
// and the mass as `mass`, so these functions are as testable by reading as
// their CPU twins.

// World -> the spin frame, a right-handed frame whose +Z is SPIN_AXIS,
// derived in physics/constants.ts from the disc's own orbital sense.
vec3 spinFrame(vec3 w) { return vec3(w.x, w.z, -w.y); }
vec3 worldFrame(vec3 s) { return vec3(s.x, -s.z, s.y); }

// Kerr-Schild radius: the positive root of
// (X^2+Y^2)/(r^2+a^2) + Z^2/r^2 = 1, equal to |X| when a is 0.
float kerrSchildRadius(vec3 X, float a) {
  float term = dot(X, X) - a * a;
  return sqrt(max(0.5 * (term + sqrt(term * term + 4.0 * a * a * X.z * X.z)), 0.0));
}

struct KerrField {
  float radius;
  float f;   // 2 M r^3 / (r^4 + a^2 Z^2)
  vec3 k;    // principal null direction, unit by construction
};

KerrField kerrField(vec3 X, float a, float mass) {
  // Floored because r divides here; only the exact center is affected, and
  // that is far inside a horizon no ray is ever marched past.
  float radius = max(kerrSchildRadius(X, a), 1e-12);
  float r2 = radius * radius;
  float w = r2 + a * a;
  float sigma = r2 * r2 + a * a * X.z * X.z;
  KerrField field;
  field.radius = radius;
  field.f = 2.0 * mass * r2 * radius / sigma;
  field.k = vec3((radius * X.x + a * X.y) / w, (radius * X.y - a * X.x) / w, X.z / radius);
  return field;
}

// Hamiltonian derivatives, in world coordinates: dx/dlambda and dp/dlambda for
// H = 0.5 (p.p - 1 - f kappa^2), kappa = 1 + k.p. `x` is measured from the hole.
void kerrDerivatives(vec3 x, vec3 p, float a, float mass, out vec3 dx, out vec3 dp) {
  vec3 X = spinFrame(x);
  vec3 P = spinFrame(p);

  KerrField field = kerrField(X, a, mass);
  float r = field.radius;
  float r2 = r * r;
  float w = r2 + a * a;
  float sigma = r2 * r2 + a * a * X.z * X.z;
  float kappa = 1.0 + dot(field.k, P);

  // grad r, from differentiating the spheroid equation above.
  float d = r * (X.x * X.x + X.y * X.y) / (w * w) + X.z * X.z / (r2 * r);
  vec3 gradR = vec3(X.x / (w * d), X.y / (w * d), X.z / (r2 * d));

  // grad f = cRadial * gradR + cAxial * zHat.
  float cRadial = 2.0 * mass * r2 * (3.0 * a * a * X.z * X.z - r2 * r2) / (sigma * sigma);
  float cAxial = -4.0 * mass * a * a * r2 * r * X.z / (sigma * sigma);

  // p . d_i k = aRadial * gradR_i + bAxis_i.
  float aRadial = (X.x * P.x + X.y * P.y - 2.0 * r * (field.k.x * P.x + field.k.y * P.y)) / w -
                  X.z * P.z / r2;
  vec3 bAxis = vec3((r * P.x - a * P.y) / w, (a * P.x + r * P.y) / w, P.z / r);

  float halfKappa2 = 0.5 * kappa * kappa;
  float fKappa = field.f * kappa;
  float radialWeight = halfKappa2 * cRadial + fKappa * aRadial;

  dx = worldFrame(P - fKappa * field.k);
  dp = worldFrame(radialWeight * gradR + vec3(0.0, 0.0, halfKappa2 * cAxial) + fKappa * bAxis);
}

// The marching direction: dx/dlambda normalized. At a = 0 the caller keeps its
// own unit velocity instead, so this is never asked for there.
vec3 kerrMarchDirection(vec3 x, vec3 p, float a, float mass) {
  KerrField field = kerrField(spinFrame(x), a, mass);
  vec3 P = spinFrame(p);
  float kappa = 1.0 + dot(field.k, P);
  return normalize(worldFrame(P - field.f * kappa * field.k));
}

// The null momentum whose spatial covector points along `dir`, so H(x, p) = 0
// exactly. s = (f beta + sqrt(1 + f (1 - beta^2))) / (1 - f beta^2), which is
// 1 when f is 0, so a distant camera launches p = dir unchanged.
vec3 kerrNullMomentum(vec3 x, vec3 dir, float a, float mass) {
  KerrField field = kerrField(spinFrame(x), a, mass);
  float beta = dot(field.k, spinFrame(dir));
  float f = field.f;
  float scale = (f * beta + sqrt(1.0 + f * (1.0 - beta * beta))) / (1.0 - f * beta * beta);
  return scale * dir;
}

struct DiscKinematics {
  float omega;    // coordinate angular speed, advects the noise field
  float beta;     // orbital speed measured by the local non-rotating observer
  float redshift; // 1/u^t
};

// Prograde equatorial circular geodesic at Boyer-Lindquist radius r. At a = 0
// these reduce algebraically to sqrt(M/r^3), sqrt(M/(r-2M)) and sqrt(1-3M/r),
// which is why the a = 0 branch in geodesic.frag can keep those literals and
// still be the same physics.
DiscKinematics kerrCircularOrbit(float r, float a, float mass) {
  float sqrtM = sqrt(mass);
  float sqrtR = sqrt(r);
  float r32 = r * sqrtR;
  float denom = r32 + a * sqrtM;
  float delta = r * r - 2.0 * mass * r + a * a;
  DiscKinematics orbit;
  orbit.omega = sqrtM / denom;
  orbit.beta = sqrtM * (r * r - 2.0 * a * sqrtM * sqrtR + a * a) / (sqrt(max(delta, 1e-9)) * denom);
  orbit.redshift = pow(r, 0.75) * sqrt(max(r32 - 3.0 * mass * sqrtR + 2.0 * a * sqrtM, 0.0)) / denom;
  return orbit;
}
