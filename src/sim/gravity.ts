/**
 * Paczynski–Wiita pseudo-Newtonian gravity for a hole of Schwarzschild
 * radius rs (mass M = rs/2): a = -(rs/2) / (r - rs)^2 * r_hat.
 *
 * Chosen over plain Newtonian gravity because it reproduces an innermost
 * stable circular orbit at exactly r = 3 rs (= R_ISCO, the disc's inner
 * edge), so bodies and debris naturally destabilize and plunge where the
 * disc ends. rs defaults to 1 (the initial primary), and grows after a
 * binary merger.
 */
import { Vector3 } from 'three';

/**
 * Gravity sources seen by bodies and debris: the primary's Schwarzschild
 * radius and, while a binary inspiral is running, the secondary hole
 * (Newtonian point mass m at pos).
 */
export interface GravityEnv {
  rs: number;
  bh2: { pos: Vector3; m: number } | null;
}

/** Writes the PW acceleration at `pos` into `out` and returns it. */
export function pwAccel(pos: Vector3, out: Vector3, rs = 1): Vector3 {
  const r = pos.length();
  const d = r - rs;
  const k = -(rs / 2) / (d * d * r);
  return out.copy(pos).multiplyScalar(k);
}

/** Circular-orbit speed at radius r in the PW potential. */
export function vCircular(r: number, rs = 1): number {
  return Math.sqrt(0.5 * rs * r) / (r - rs);
}

/**
 * One semi-implicit (symplectic) Euler step with velocity drag.
 * Mutates pos and vel in place. `scratch` avoids per-tick allocation.
 */
export function stepOrbit(
  pos: Vector3,
  vel: Vector3,
  dt: number,
  drag: number,
  scratch: Vector3,
  rs = 1,
): void {
  pwAccel(pos, scratch, rs);
  vel.addScaledVector(scratch, dt);
  vel.multiplyScalar(1 - drag * dt);
  pos.addScaledVector(vel, dt);
}
