/**
 * An orbit as an orbit, rather than as one position and one velocity.
 *
 * Debris has to be launched *onto the body's orbit* at its own radius. Copying
 * the body's velocity vector instead hands a particle displaced a body-length
 * inward the same speed with far less angular momentum, so the near half of
 * every tidal stream dives into the hole rather than swinging back out, and the
 * returning ribbon never forms.
 *
 * Pseudo-Newtonian throughout, matching the rest of the simulation:
 * eps = v^2/2 - (rs/2)/(r - rs).
 */
import type { Vector3 } from 'three';

export interface Orbit {
  /** Specific orbital energy; negative is bound. */
  energy: number;
  /** Specific angular momentum |r x v|. */
  angularMomentum: number;
  /** Unit vector along the tangential part of the motion. */
  tangentX: number;
  tangentY: number;
  tangentZ: number;
  /** -1 while falling inward, +1 while climbing out. */
  radialSign: number;
}

/** Read the orbit a body is currently on. */
export function orbitOf(pos: Vector3, vel: Vector3, rs: number): Orbit {
  const r = Math.max(pos.length(), 1e-6);
  const radialX = pos.x / r;
  const radialY = pos.y / r;
  const radialZ = pos.z / r;
  const radialSpeed = vel.x * radialX + vel.y * radialY + vel.z * radialZ;

  const tangentX = vel.x - radialSpeed * radialX;
  const tangentY = vel.y - radialSpeed * radialY;
  const tangentZ = vel.z - radialSpeed * radialZ;
  const tangentialSpeed = Math.max(Math.hypot(tangentX, tangentY, tangentZ), 1e-9);

  return {
    energy: 0.5 * vel.lengthSq() - rs / 2 / Math.max(r - rs, 1e-3),
    angularMomentum: r * tangentialSpeed,
    tangentX: tangentX / tangentialSpeed,
    tangentY: tangentY / tangentialSpeed,
    tangentZ: tangentZ / tangentialSpeed,
    radialSign: radialSpeed < 0 ? -1 : 1,
  };
}

/**
 * The velocity a particle needs to sit on `orbit` at radius `r`: angular
 * momentum fixes the tangential speed, energy fixes the total, and the
 * remainder is radial, in the direction the orbit is already going.
 *
 * Writes into `out` to keep the spawn loop allocation-free.
 */
export function velocityOnOrbit(
  orbit: Orbit,
  radialX: number,
  radialY: number,
  radialZ: number,
  r: number,
  rs: number,
  out: { x: number; y: number; z: number },
): void {
  const tangential = orbit.angularMomentum / r;
  const totalSq = 2 * (orbit.energy + rs / 2 / Math.max(r - rs, 1e-3));
  const radial = orbit.radialSign * Math.sqrt(Math.max(totalSq - tangential * tangential, 0));
  out.x = orbit.tangentX * tangential + radialX * radial;
  out.y = orbit.tangentY * tangential + radialY * radial;
  out.z = orbit.tangentZ * tangential + radialZ * radial;
}
