/**
 * CPU integrator for null geodesics. Two paths live here, and the shader
 * mirrors both line for line so the drawn photon paths land exactly on the
 * features the raymarcher renders (photon ring, shadow edge).
 *
 * SCHWARZSCHILD (the default, and the only path when `spin` is 0 or absent).
 * The 3D vector form of the photon equation of motion (r_s = 1 units):
 *
 *     x'' = -1.5 * r_s * h^2 * x / r^5,   h = |x × x'|
 *
 * equivalent to the Binet equation u'' = -u + (3/2) r_s u^2 but needing no
 * per-ray orbital-plane basis and having no singularity for radial rays.
 * With a second black hole present, the deflections of the two centers are
 * superposed (each with its own h about that center), the standard
 * approximation, exact for one hole and qualitatively right for two.
 *
 * KERR (`spin` > 0, one center only). The exact Kerr metric in Cartesian
 * Kerr-Schild form, integrated as a Hamiltonian system on (x, p_i) with
 * p_t = -1:
 *
 *     g^{mu nu} = eta^{mu nu} - f l^mu l^nu,   l^0 = -1, l^i = k_i
 *     H = 0.5 (p.p - 1 - f kappa^2),           kappa = 1 + k.p
 *     dx/dlambda =  dH/dp = p - f kappa k
 *     dp/dlambda = -dH/dx = 0.5 kappa^2 grad(f) + f kappa (p . grad k)
 *
 * Kerr-Schild is the coordinate system that survives the horizon (no
 * coordinate singularity at r+), and its Cartesian layout matches the
 * existing march, so the disc-crossing test and the body intersection are
 * unchanged. The spatial derivatives are analytic, so one derivative
 * evaluation costs one field evaluation.
 *
 * The two paths are deliberately not unified. The Kerr expressions are
 * analytically identical to the Schwarzschild ones at a = 0 but not identical
 * in floating point, and `spin: 0` has to reproduce the shipped image exactly.
 */
import {
  DT_MAX,
  DT_MIN,
  M,
  R_CAPTURE,
  R_ESCAPE,
  SPIN_AXIS,
  STEP_K,
} from './constants';
import { sweptAngle } from './imageOrder';
import { horizonRadius } from './kerr';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A lensing center: position plus Schwarzschild radius. */
export interface GravityCenter {
  x: number;
  y: number;
  z: number;
  rs: number;
}

export type GeodesicFate = 'captured' | 'escaped' | 'maxsteps';

export interface GeodesicResult {
  /** Recorded trajectory points as xyz triplets. */
  points: Float32Array;
  fate: GeodesicFate;
  /** Impact parameter |x0 × dir| about the primary (first center). */
  b: number;
  /**
   * Signed axial angular momentum L_z about SPIN_AXIS at launch. Positive is
   * prograde with the hole's spin and with the disc, which is what picks the
   * prograde or retrograde critical impact parameter for this ray.
   */
  axialAngularMomentum: number;
  /**
   * Total angle swept about the primary along the path. Feed it to
   * `imageOrder` in physics/imageOrder.ts to say which lensed image of the
   * disc this ray belongs to.
   */
  windingAngle: number;
}

export interface GeodesicOptions {
  maxSteps?: number;
  escapeR?: number;
  /** Record every Nth integration step into the output polyline. */
  recordEvery?: number;
  /** Lensing centers; defaults to a unit black hole at the origin. */
  centers?: readonly GravityCenter[];
  /**
   * Dimensionless Kerr spin a/M, prograde with the disc. 0 (the default)
   * selects the Schwarzschild path verbatim. Defined for a single center only.
   */
  spin?: number;
}

const DEFAULT_CENTERS: readonly GravityCenter[] = [{ x: 0, y: 0, z: 0, rs: 1 }];

interface State {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
}

function accelInto(
  out: Vec3,
  px: number,
  py: number,
  pz: number,
  vx: number,
  vy: number,
  vz: number,
  centers: readonly GravityCenter[],
): void {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  for (const c of centers) {
    const dx = px - c.x;
    const dy = py - c.y;
    const dz = pz - c.z;
    const hx = dy * vz - dz * vy;
    const hy = dz * vx - dx * vz;
    const hz = dx * vy - dy * vx;
    const h2 = hx * hx + hy * hy + hz * hz;
    const r2 = dx * dx + dy * dy + dz * dz;
    const k = (-1.5 * c.rs * h2) / (r2 * r2 * Math.sqrt(r2));
    out.x += k * dx;
    out.y += k * dy;
    out.z += k * dz;
  }
}

const a1: Vec3 = { x: 0, y: 0, z: 0 };
const a2: Vec3 = { x: 0, y: 0, z: 0 };
const a3: Vec3 = { x: 0, y: 0, z: 0 };
const a4: Vec3 = { x: 0, y: 0, z: 0 };

function rk4Step(s: State, dt: number, centers: readonly GravityCenter[]): void {
  const h = dt * 0.5;
  accelInto(a1, s.px, s.py, s.pz, s.vx, s.vy, s.vz, centers);

  const v2x = s.vx + h * a1.x;
  const v2y = s.vy + h * a1.y;
  const v2z = s.vz + h * a1.z;
  accelInto(a2, s.px + h * s.vx, s.py + h * s.vy, s.pz + h * s.vz, v2x, v2y, v2z, centers);

  const v3x = s.vx + h * a2.x;
  const v3y = s.vy + h * a2.y;
  const v3z = s.vz + h * a2.z;
  accelInto(a3, s.px + h * v2x, s.py + h * v2y, s.pz + h * v2z, v3x, v3y, v3z, centers);

  const v4x = s.vx + dt * a3.x;
  const v4y = s.vy + dt * a3.y;
  const v4z = s.vz + dt * a3.z;
  accelInto(a4, s.px + dt * v3x, s.py + dt * v3y, s.pz + dt * v3z, v4x, v4y, v4z, centers);

  const sixth = dt / 6;
  s.px += sixth * (s.vx + 2 * v2x + 2 * v3x + v4x);
  s.py += sixth * (s.vy + 2 * v2y + 2 * v3y + v4y);
  s.pz += sixth * (s.vz + 2 * v2z + 2 * v3z + v4z);
  s.vx += sixth * (a1.x + 2 * a2.x + 2 * a3.x + a4.x);
  s.vy += sixth * (a1.y + 2 * a2.y + 2 * a3.y + a4.y);
  s.vz += sixth * (a1.z + 2 * a2.z + 2 * a3.z + a4.z);
}

function captured(s: State, centers: readonly GravityCenter[]): boolean {
  for (const c of centers) {
    const dx = s.px - c.x;
    const dy = s.py - c.y;
    const dz = s.pz - c.z;
    const cap = R_CAPTURE * c.rs;
    if (dx * dx + dy * dy + dz * dz < cap * cap) return true;
  }
  return false;
}

function stepSize(s: State, centers: readonly GravityCenter[]): number {
  let margin = Infinity;
  for (const c of centers) {
    const d = Math.hypot(s.px - c.x, s.py - c.y, s.pz - c.z) - 0.9 * c.rs;
    margin = Math.min(margin, d);
  }
  return Math.min(Math.max(STEP_K * margin, DT_MIN), DT_MAX);
}

// --- Kerr-Schild field and Hamiltonian ---------------------------------
//
// Everything from here to `integrateKerr` is written in the spin frame, a
// right-handed frame whose +Z is the hole's angular momentum; `spinFrame` and
// `worldFrame` in kerr.ts convert. The frame conversion is a swizzle, so the
// march itself stays in world coordinates and the disc, jet and body geometry
// are untouched.

/** Kerr-Schild scalars at a point in the spin frame. */
interface KerrField {
  /** Kerr-Schild radius: |x| when a = 0, an oblate spheroid otherwise. */
  radius: number;
  /** f = 2 M r^3 / (r^4 + a^2 Z^2), the whole mass dependence of the metric. */
  f: number;
  /** The principal null direction, a unit vector by construction. */
  kx: number;
  ky: number;
  kz: number;
}

const field: KerrField = { radius: 0, f: 0, kx: 0, ky: 0, kz: 0 };

function kerrFieldInto(out: KerrField, X: number, Y: number, Z: number, a: number, mass: number): void {
  const term = X * X + Y * Y + Z * Z - a * a;
  const radius = Math.sqrt(Math.max(0.5 * (term + Math.sqrt(term * term + 4 * a * a * Z * Z)), 1e-12));
  const r2 = radius * radius;
  const w = r2 + a * a;
  const sigma = r2 * r2 + a * a * Z * Z;
  out.radius = radius;
  out.f = (2 * mass * r2 * radius) / sigma;
  out.kx = (radius * X + a * Y) / w;
  out.ky = (radius * Y - a * X) / w;
  out.kz = Z / radius;
}

/**
 * Hamiltonian derivatives in world coordinates: dx/dlambda into `outDx`,
 * dp/dlambda into `outDp`. `x` is measured from the hole's center.
 */
function kerrDerivativesInto(
  outDx: Vec3,
  outDp: Vec3,
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  pz: number,
  a: number,
  mass: number,
): void {
  // World -> spin frame (see kerr.ts spinFrame); p is rotated like x.
  const bigX = x;
  const bigY = z;
  const bigZ = -y;
  const bigPx = px;
  const bigPy = pz;
  const bigPz = -py;

  kerrFieldInto(field, bigX, bigY, bigZ, a, mass);
  const r = field.radius;
  const r2 = r * r;
  const w = r2 + a * a;
  const sigma = r2 * r2 + a * a * bigZ * bigZ;
  const f = field.f;
  const kappa = 1 + field.kx * bigPx + field.ky * bigPy + field.kz * bigPz;

  // grad r, from differentiating (X^2+Y^2)/(r^2+a^2) + Z^2/r^2 = 1.
  const d = (r * (bigX * bigX + bigY * bigY)) / (w * w) + (bigZ * bigZ) / (r2 * r);
  const gradRx = bigX / (w * d);
  const gradRy = bigY / (w * d);
  const gradRz = bigZ / (r2 * d);

  // grad f = cRadial * grad r + cAxial * zHat.
  const cRadial = (2 * mass * r2 * (3 * a * a * bigZ * bigZ - r2 * r2)) / (sigma * sigma);
  const cAxial = (-4 * mass * a * a * r2 * r * bigZ) / (sigma * sigma);

  // p . d_i k = aRadial * grad r_i + bAxis_i.
  const aRadial =
    (bigX * bigPx + bigY * bigPy - 2 * r * (field.kx * bigPx + field.ky * bigPy)) / w -
    (bigZ * bigPz) / r2;
  const bAxisX = (r * bigPx - a * bigPy) / w;
  const bAxisY = (a * bigPx + r * bigPy) / w;
  const bAxisZ = bigPz / r;

  const halfKappa2 = 0.5 * kappa * kappa;
  const fKappa = f * kappa;
  const radialWeight = halfKappa2 * cRadial + fKappa * aRadial;

  const dxX = bigPx - fKappa * field.kx;
  const dxY = bigPy - fKappa * field.ky;
  const dxZ = bigPz - fKappa * field.kz;
  const dpX = radialWeight * gradRx + fKappa * bAxisX;
  const dpY = radialWeight * gradRy + fKappa * bAxisY;
  const dpZ = radialWeight * gradRz + halfKappa2 * cAxial + fKappa * bAxisZ;

  // Spin frame -> world (worldFrame).
  outDx.x = dxX;
  outDx.y = -dxZ;
  outDx.z = dxY;
  outDp.x = dpX;
  outDp.y = -dpZ;
  outDp.z = dpY;
}

/**
 * The Hamiltonian at a state, which is exactly 0 for a null ray and is the
 * conserved quantity the integration tests watch. `x` is measured from the
 * hole's center, in world coordinates.
 */
export function kerrHamiltonian(x: Vec3, p: Vec3, a: number, mass: number = M): number {
  kerrFieldInto(field, x.x, x.z, -x.y, a, mass);
  const kappa = 1 + field.kx * p.x + field.ky * p.z + field.kz * -p.y;
  return 0.5 * (p.x * p.x + p.y * p.y + p.z * p.z - 1 - field.f * kappa * kappa);
}

/**
 * The null momentum whose spatial covector points along `dir`, so that
 * H(x, p) = 0 exactly. Solving the quadratic in the scale factor gives
 *
 *     s = (f beta + sqrt(1 + f (1 - beta^2))) / (1 - f beta^2),  beta = k.dir
 *
 * which is 1 when f is 0, so a distant camera launches p = dir unchanged.
 * The denominator is positive everywhere outside the horizon, and the camera
 * rig clamps to 3 r_s.
 */
export function kerrNullMomentum(x: Vec3, dir: Vec3, a: number, mass: number = M): Vec3 {
  kerrFieldInto(field, x.x, x.z, -x.y, a, mass);
  const beta = field.kx * dir.x + field.ky * dir.z + field.kz * -dir.y;
  const f = field.f;
  const scale = (f * beta + Math.sqrt(1 + f * (1 - beta * beta))) / (1 - f * beta * beta);
  return { x: scale * dir.x, y: scale * dir.y, z: scale * dir.z };
}

/** dx/dlambda and dp/dlambda at a state, in world coordinates. */
export interface KerrDerivative {
  dx: Vec3;
  dp: Vec3;
}

/**
 * The Kerr equations of motion at one state, allocating a fresh result.
 * The integrator uses the scratch-buffer form; this is the same physics in
 * the shape a test or a reader wants, and it is what the conservation tests
 * drive directly.
 */
export function kerrDerivatives(x: Vec3, p: Vec3, a: number, mass: number = M): KerrDerivative {
  const dx: Vec3 = { x: 0, y: 0, z: 0 };
  const dp: Vec3 = { x: 0, y: 0, z: 0 };
  kerrDerivativesInto(dx, dp, x.x, x.y, x.z, p.x, p.y, p.z, a, mass);
  return { dx, dp };
}

interface KerrState {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
}

const dx1: Vec3 = { x: 0, y: 0, z: 0 };
const dp1: Vec3 = { x: 0, y: 0, z: 0 };
const dx2: Vec3 = { x: 0, y: 0, z: 0 };
const dp2: Vec3 = { x: 0, y: 0, z: 0 };
const dx3: Vec3 = { x: 0, y: 0, z: 0 };
const dp3: Vec3 = { x: 0, y: 0, z: 0 };
const dx4: Vec3 = { x: 0, y: 0, z: 0 };
const dp4: Vec3 = { x: 0, y: 0, z: 0 };

function rk4KerrStep(s: KerrState, dt: number, a: number, mass: number): void {
  const h = dt * 0.5;
  kerrDerivativesInto(dx1, dp1, s.x, s.y, s.z, s.px, s.py, s.pz, a, mass);
  kerrDerivativesInto(
    dx2, dp2,
    s.x + h * dx1.x, s.y + h * dx1.y, s.z + h * dx1.z,
    s.px + h * dp1.x, s.py + h * dp1.y, s.pz + h * dp1.z,
    a, mass,
  );
  kerrDerivativesInto(
    dx3, dp3,
    s.x + h * dx2.x, s.y + h * dx2.y, s.z + h * dx2.z,
    s.px + h * dp2.x, s.py + h * dp2.y, s.pz + h * dp2.z,
    a, mass,
  );
  kerrDerivativesInto(
    dx4, dp4,
    s.x + dt * dx3.x, s.y + dt * dx3.y, s.z + dt * dx3.z,
    s.px + dt * dp3.x, s.py + dt * dp3.y, s.pz + dt * dp3.z,
    a, mass,
  );
  const sixth = dt / 6;
  s.x += sixth * (dx1.x + 2 * dx2.x + 2 * dx3.x + dx4.x);
  s.y += sixth * (dx1.y + 2 * dx2.y + 2 * dx3.y + dx4.y);
  s.z += sixth * (dx1.z + 2 * dx2.z + 2 * dx3.z + dx4.z);
  s.px += sixth * (dp1.x + 2 * dp2.x + 2 * dp3.x + dp4.x);
  s.py += sixth * (dp1.y + 2 * dp2.y + 2 * dp3.y + dp4.y);
  s.pz += sixth * (dp1.z + 2 * dp2.z + 2 * dp3.z + dp4.z);
}

/** Signed angular momentum about the spin axis: (x cross p) . SPIN_AXIS. */
function axialAngularMomentumOf(x: Vec3, p: Vec3): number {
  return (
    (x.y * p.z - x.z * p.y) * SPIN_AXIS.x +
    (x.z * p.x - x.x * p.z) * SPIN_AXIS.y +
    (x.x * p.y - x.y * p.x) * SPIN_AXIS.z
  );
}

const chordFrom: Vec3 = { x: 0, y: 0, z: 0 };
const chordTo: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Integrate a photon launched from `origin` along `dir` until it is captured
 * by a horizon, escapes past `escapeR` moving outward, or runs out of steps
 * (near-critical rays orbiting a photon sphere).
 *
 * Pass `spin` to solve the exact Kerr metric instead; it is defined for a
 * single center only and throws otherwise.
 */
export function integrateNullGeodesic(
  origin: Vec3,
  dir: Vec3,
  opts: GeodesicOptions = {},
): GeodesicResult {
  const maxSteps = opts.maxSteps ?? 4000;
  const escapeR = opts.escapeR ?? R_ESCAPE;
  const recordEvery = opts.recordEvery ?? 2;
  const centers = opts.centers && opts.centers.length > 0 ? opts.centers : DEFAULT_CENTERS;
  const spin = opts.spin ?? 0;

  if (spin > 0 && centers.length > 1) {
    throw new Error('Kerr spin is not defined for superposed centers');
  }
  if (spin > 0) {
    return integrateKerr(origin, dir, spin, centers[0]!, maxSteps, escapeR, recordEvery);
  }

  const dLen = Math.hypot(dir.x, dir.y, dir.z);
  const s: State = {
    px: origin.x,
    py: origin.y,
    pz: origin.z,
    vx: dir.x / dLen,
    vy: dir.y / dLen,
    vz: dir.z / dLen,
  };
  const primary = centers[0]!;
  const rx = s.px - primary.x;
  const ry = s.py - primary.y;
  const rz = s.pz - primary.z;
  const b = Math.hypot(ry * s.vz - rz * s.vy, rz * s.vx - rx * s.vz, rx * s.vy - ry * s.vx);
  const axialAngularMomentum = axialAngularMomentumOf(
    { x: rx, y: ry, z: rz },
    { x: s.vx, y: s.vy, z: s.vz },
  );

  const pts: number[] = [s.px, s.py, s.pz];
  let fate: GeodesicFate = 'maxsteps';
  let windingAngle = 0;

  for (let i = 0; i < maxSteps; i++) {
    if (captured(s, centers)) {
      fate = 'captured';
      break;
    }
    const r = Math.hypot(s.px, s.py, s.pz);
    const outward = s.px * s.vx + s.py * s.vy + s.pz * s.vz > 0;
    if (r > escapeR && outward) {
      fate = 'escaped';
      break;
    }

    chordFrom.x = s.px - primary.x;
    chordFrom.y = s.py - primary.y;
    chordFrom.z = s.pz - primary.z;
    rk4Step(s, stepSize(s, centers), centers);
    chordTo.x = s.px - primary.x;
    chordTo.y = s.py - primary.y;
    chordTo.z = s.pz - primary.z;
    windingAngle += sweptAngle(chordFrom, chordTo);
    if (i % recordEvery === 0) pts.push(s.px, s.py, s.pz);
  }
  pts.push(s.px, s.py, s.pz);

  return { points: new Float32Array(pts), fate, b, axialAngularMomentum, windingAngle };
}

function integrateKerr(
  origin: Vec3,
  dir: Vec3,
  spin: number,
  center: GravityCenter,
  maxSteps: number,
  escapeR: number,
  recordEvery: number,
): GeodesicResult {
  const mass = 0.5 * center.rs;
  const a = spin * mass;
  const rPlus = horizonRadius(spin) * center.rs;
  const capture = R_CAPTURE * rPlus;

  const dLen = Math.hypot(dir.x, dir.y, dir.z);
  const unitDir: Vec3 = { x: dir.x / dLen, y: dir.y / dLen, z: dir.z / dLen };
  const start: Vec3 = {
    x: origin.x - center.x,
    y: origin.y - center.y,
    z: origin.z - center.z,
  };
  const p0 = kerrNullMomentum(start, unitDir, a, mass);

  const s: KerrState = { x: start.x, y: start.y, z: start.z, px: p0.x, py: p0.y, pz: p0.z };
  const b = Math.hypot(
    start.y * unitDir.z - start.z * unitDir.y,
    start.z * unitDir.x - start.x * unitDir.z,
    start.x * unitDir.y - start.y * unitDir.x,
  );
  const axialAngularMomentum = axialAngularMomentumOf(start, p0);

  const pts: number[] = [origin.x, origin.y, origin.z];
  let fate: GeodesicFate = 'maxsteps';
  let windingAngle = 0;

  for (let i = 0; i < maxSteps; i++) {
    kerrFieldInto(field, s.x, s.z, -s.y, a, mass);
    const radius = field.radius;
    if (radius < capture) {
      fate = 'captured';
      break;
    }
    // Escape is tested against the marching direction dx/dlambda = p - f kappa k,
    // not against p: near the hole the two differ by a large angle, and the
    // sign of x . dx is what actually says the ray is leaving.
    const kappa = 1 + field.kx * s.px + field.ky * s.pz + field.kz * -s.py;
    const drag = field.f * kappa;
    // dx/dlambda in the spin frame is (px - drag kX, pz - drag kY, -py - drag kZ);
    // worldFrame maps that back to (X, -Z, Y).
    const marchX = s.px - drag * field.kx;
    const marchY = s.py + drag * field.kz;
    const marchZ = s.pz - drag * field.ky;
    const rCoord = Math.hypot(s.x, s.y, s.z);
    if (rCoord > escapeR && s.x * marchX + s.y * marchY + s.z * marchZ > 0) {
      fate = 'escaped';
      break;
    }

    const dt = Math.min(Math.max(STEP_K * (radius - 0.9 * rPlus), DT_MIN), DT_MAX);
    chordFrom.x = s.x;
    chordFrom.y = s.y;
    chordFrom.z = s.z;
    rk4KerrStep(s, dt, a, mass);
    chordTo.x = s.x;
    chordTo.y = s.y;
    chordTo.z = s.z;
    windingAngle += sweptAngle(chordFrom, chordTo);
    if (i % recordEvery === 0) pts.push(s.x + center.x, s.y + center.y, s.z + center.z);
  }
  pts.push(s.x + center.x, s.y + center.y, s.z + center.z);

  return { points: new Float32Array(pts), fate, b, axialAngularMomentum, windingAngle };
}

/** Weak-field light deflection angle (radians) for impact parameter b, r_s = 1. */
export function approxDeflection(b: number): number {
  return 2 / b;
}
