/**
 * Kerr black hole: the closed forms, the Kerr-Schild field, and the frame the
 * two live in. Pure functions, geometric units with r_s = 1 (so M = 0.5), no
 * Three.js and no DOM.
 *
 * Two different spin numbers appear here and mixing them up is the easiest way
 * to get everything subtly wrong, so they are named apart:
 *
 * - `spin` is the dimensionless a/M in [0, A_STAR_MAX]. Every closed-form
 *   radius takes this and returns a length in r_s units.
 * - `a` is the same spin in length units, a = spin * M (times r_s at the call
 *   site when the hole has grown). The Kerr-Schild field takes this.
 *
 * Sign conventions. All Kerr math runs in a right-handed frame with the spin
 * along +Z; `spinFrame` and `worldFrame` convert. `SPIN_AXIS` in constants.ts
 * derives that direction from the disc's own orbital sense, so a positive spin
 * is prograde with the gas. The signs of the `a` terms in the null vector `k`
 * set the drag direction and are pinned by the prograde/retrograde capture
 * test in __tests__/geodesic.test.ts, not by a citation.
 *
 * Sources: Bardeen, Press and Teukolsky (1972) for the ISCO and the photon
 * orbits; Kerr (1963) in the Kerr-Schild Cartesian form for the field.
 */
import { M } from './constants';
import type { Vec3 } from './geodesic';

/** Which way round the hole an orbit runs, relative to the spin. */
export type OrbitSense = 'prograde' | 'retrograde';

function senseSign(sense: OrbitSense): number {
  return sense === 'prograde' ? 1 : -1;
}

function clampToUnitInterval(x: number): number {
  return Math.min(Math.max(x, -1), 1);
}

/**
 * Outer event horizon, r+ = M (1 + sqrt(1 - (a/M)^2)).
 * spin 0 -> 1.0 = R_S; spin 0.998 -> 0.5316; spin 1 -> M = 0.5.
 */
export function horizonRadius(spin: number): number {
  return M * (1 + Math.sqrt(Math.max(1 - spin * spin, 0)));
}

/**
 * Inner (Cauchy) horizon, r- = M (1 - sqrt(1 - (a/M)^2)). Nothing in the app
 * renders it; it exists so the ordering test can assert r- < r+ and so
 * docs/THEORY.md can point at a definition rather than a claim.
 */
export function innerHorizonRadius(spin: number): number {
  return M * (1 - Math.sqrt(Math.max(1 - spin * spin, 0)));
}

/**
 * Innermost stable circular orbit, the disc's inner edge (Bardeen, Press and
 * Teukolsky 1972, eq. 2.21).
 *
 * spin 0 -> 3.0 r_s = R_ISCO for both senses; spin 0.998 prograde -> 0.61849;
 * spin 1 prograde -> M = 0.5, retrograde -> 9M = 4.5.
 */
export function innermostStableCircularOrbit(spin: number, sense: OrbitSense): number {
  const sgn = senseSign(sense);
  const spin2 = spin * spin;
  const z1 = 1 + Math.cbrt(1 - spin2) * (Math.cbrt(1 + spin) + Math.cbrt(1 - spin));
  const z2 = Math.sqrt(3 * spin2 + z1 * z1);
  return M * (3 + z2 - sgn * Math.sqrt(Math.max((3 - z1) * (3 + z1 + 2 * z2), 0)));
}

/**
 * Radius of the equatorial circular photon orbit. Spin splits the single
 * Schwarzschild photon sphere into two: the prograde one is dragged inward
 * toward the horizon, the retrograde one pushed out.
 *
 * spin 0 -> 1.5 = R_PHOTON for both senses; spin 0.998 -> 0.53695 prograde and
 * 1.9991 retrograde; spin 1 -> M = 0.5 prograde and 4M = 2.0 retrograde.
 */
export function circularPhotonOrbitRadius(spin: number, sense: OrbitSense): number {
  const sgn = senseSign(sense);
  return 2 * M * (1 + Math.cos((2 / 3) * Math.acos(clampToUnitInterval(-sgn * spin))));
}

/**
 * Signed critical impact parameter b = L_z/E evaluated on the circular photon
 * orbit of that sense: positive prograde, negative retrograde. Its magnitude
 * is the apparent radius of that edge of the shadow, which is why the shadow
 * goes lopsided as the spin rises.
 *
 * Solving R(r) = R'(r) = 0 for the equatorial null radial potential gives
 * b = a +- 2 r sqrt(Delta) / (r - M) at r = r_photon.
 *
 * spin 0 -> +-3*sqrt(3)*M = +-B_CRIT; spin 0.998 -> +1.05544 and -3.498;
 * spin 1 retrograde -> -7M = -3.5.
 *
 * Prograde at exactly spin = 1 is degenerate: r_photon, r+ and M all coincide,
 * (r - M) goes to zero and this expression is undefined (the true limit is
 * 2M). The app never reaches it, because `setPrimarySpin` clamps to
 * A_STAR_MAX = 0.998.
 */
export function criticalImpactParameter(spin: number, sense: OrbitSense): number {
  const sgn = senseSign(sense);
  const a = spin * M;
  const r = circularPhotonOrbitRadius(spin, sense);
  const delta = r * r - 2 * M * r + a * a;
  return a + (sgn * 2 * r * Math.sqrt(Math.max(delta, 0))) / (r - M);
}

/**
 * The Kerr-Schild radius at a point in the spin frame: the positive root of
 * (X^2 + Y^2)/(r^2 + a^2) + Z^2/r^2 = 1, so surfaces of constant r are
 * confocal oblate spheroids rather than spheres. Equals |x| exactly when
 * a = 0, and approaches |x| from below as |x| grows.
 *
 * This is the radius every other Kerr expression is written in, and the one
 * the horizon and capture tests are measured against.
 */
export function kerrSchildRadius(x: number, y: number, z: number, a: number): number {
  const term = x * x + y * y + z * z - a * a;
  return Math.sqrt(Math.max(0.5 * (term + Math.sqrt(term * term + 4 * a * a * z * z)), 0));
}

/**
 * World coordinates -> the spin frame, a right-handed frame whose +Z lies
 * along SPIN_AXIS = (0, -1, 0). Check: the disc's velocity direction at world
 * (r, 0, 0) is (0, 0, 1), which maps to +Y, so increasing azimuth about +Z is
 * prograde with the gas.
 */
export function spinFrame(world: Vec3): Vec3 {
  return { x: world.x, y: world.z, z: -world.y };
}

/** The spin frame -> world coordinates; the exact inverse of `spinFrame`. */
export function worldFrame(spun: Vec3): Vec3 {
  return { x: spun.x, y: -spun.z, z: spun.y };
}

/** Kinematics of the prograde equatorial circular geodesic the disc rides. */
export interface CircularOrbitKinematics {
  /** Coordinate angular speed d(phi)/dt: sqrt(M) / (r^1.5 + a sqrt(M)). */
  omega: number;
  /** Orbital speed measured by the local non-rotating (ZAMO) observer. */
  speedVsZamo: number;
  /** 1/u^t, the gravitational + time-dilation factor for the emitted light. */
  redshift: number;
}

/**
 * Prograde equatorial circular geodesic at Boyer-Lindquist radius `radius`,
 * with `a` in length units. At a = 0 these reduce algebraically and exactly to
 * the three Schwarzschild expressions the disc shader has always used:
 * sqrt(M/r^3), sqrt(M/(r - 2M)) and sqrt(1 - 3M/r).
 */
export function circularOrbitKinematics(radius: number, a: number): CircularOrbitKinematics {
  const sqrtM = Math.sqrt(M);
  const sqrtR = Math.sqrt(radius);
  const r32 = radius * sqrtR;
  const denom = r32 + a * sqrtM;
  const delta = radius * radius - 2 * M * radius + a * a;
  return {
    omega: sqrtM / denom,
    speedVsZamo:
      (sqrtM * (radius * radius - 2 * a * sqrtM * sqrtR + a * a)) /
      (Math.sqrt(Math.max(delta, 1e-9)) * denom),
    redshift:
      (Math.pow(radius, 0.75) * Math.sqrt(Math.max(r32 - 3 * M * sqrtR + 2 * a * sqrtM, 0))) /
      denom,
  };
}
