/**
 * CPU integrator for Schwarzschild null geodesics.
 *
 * Uses the 3D vector form of the photon equation of motion (r_s = 1 units):
 *
 *     x'' = -1.5 * r_s * h^2 * x / r^5,   h = |x × x'|
 *
 * equivalent to the Binet equation u'' = -u + (3/2) r_s u^2 but needing no
 * per-ray orbital-plane basis and having no singularity for radial rays.
 * With a second black hole present, the deflections of the two centers are
 * superposed (each with its own h about that center) — the standard
 * approximation, exact for one hole and qualitatively right for two.
 * The same equations, RK4 scheme, and step-size formula run in the fragment
 * shader, so paths drawn from these results land exactly on the features the
 * shader renders (photon ring, shadow edge).
 */
import { DT_MAX, DT_MIN, R_CAPTURE, R_ESCAPE, STEP_K } from './constants';

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
}

export interface GeodesicOptions {
  maxSteps?: number;
  escapeR?: number;
  /** Record every Nth integration step into the output polyline. */
  recordEvery?: number;
  /** Lensing centers; defaults to a unit black hole at the origin. */
  centers?: readonly GravityCenter[];
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

/**
 * Integrate a photon launched from `origin` along `dir` until it is captured
 * by a horizon, escapes past `escapeR` moving outward, or runs out of steps
 * (near-critical rays orbiting a photon sphere).
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

  const pts: number[] = [s.px, s.py, s.pz];
  let fate: GeodesicFate = 'maxsteps';

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

    rk4Step(s, stepSize(s, centers), centers);
    if (i % recordEvery === 0) pts.push(s.px, s.py, s.pz);
  }
  pts.push(s.px, s.py, s.pz);

  return { points: new Float32Array(pts), fate, b };
}

/** Weak-field light deflection angle (radians) for impact parameter b, r_s = 1. */
export function approxDeflection(b: number): number {
  return 2 / b;
}
