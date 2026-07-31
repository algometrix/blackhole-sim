/**
 * Physics constants for a Kerr black hole in geometric units, whose zero-spin
 * case is Schwarzschild.
 *
 * c = G = 1 and the length unit is the Schwarzschild radius, r_s = 1,
 * so the mass is M = 1/2. The black hole sits at the world origin and the
 * accretion disc lies in the equatorial plane y = 0. Every other module
 * (CPU integrator, GLSL shaders, simulation) reads its numbers from here,
 * which is what keeps the shader image and the CPU photon paths consistent.
 *
 * The four radii below (R_S, R_PHOTON, R_ISCO, B_CRIT) are the a = 0
 * specialisations of the closed forms in physics/kerr.ts. A test pins them
 * against each other, so the two files cannot drift apart.
 */

/** Schwarzschild radius (the event horizon at zero spin). */
export const R_S = 1.0;

/** Black hole mass: r_s = 2M with r_s = 1. */
export const M = 0.5;

/** Photon sphere radius at zero spin, 3M. */
export const R_PHOTON = 1.5;

/** Innermost stable circular orbit at zero spin, 6M = 3 r_s. */
export const R_ISCO = 3.0;

/** Outer edge of the accretion disc. */
export const DISC_OUTER = 9.0;

/**
 * Critical impact parameter b_crit = 3*sqrt(3)*M at zero spin. Rays aimed
 * with b below this are captured; it is also the apparent shadow radius.
 */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;

/**
 * Largest dimensionless spin a/M the app allows, the Thorne limit. A hole fed
 * by a thin disc cannot be spun past roughly this: the photons it captures
 * from the inner disc carry negative angular momentum on average and spin it
 * back down, so accretion saturates near 0.998 rather than at 1. It doubles as
 * the value that keeps the near-extremal closed forms well conditioned, since
 * (r_photon - M) in the critical impact parameter goes to zero at a/M = 1.
 */
export const A_STAR_MAX = 0.998;

/**
 * Unit vector along the hole's angular momentum for a positive spin, in world
 * coordinates. Derived, not chosen: the disc orbits along
 * phiHat = (-z, 0, x) (see `discEmission` in shaders/geodesic.frag and
 * `initialVelocity` in sim/placement.ts), so at world (r, 0, 0) the gas moves
 * along +z and its angular momentum r x v points along -y. A positive spin is
 * prograde with the disc, so it points the same way.
 */
export const SPIN_AXIS = { x: 0, y: -1, z: 0 } as const;

/** Radius beyond which an outward-moving ray is considered escaped. */
export const R_ESCAPE = 40.0;

/** Capture radius, as a multiple of the horizon radius. */
export const R_CAPTURE = 1.02;

/** Adaptive step size: dt = clamp(STEP_K * (r - 0.9 * r_horizon), DT_MIN, DT_MAX). */
export const STEP_K = 0.15;
export const DT_MIN = 0.02;
export const DT_MAX = 0.35;

/**
 * GLSL `#define` map mirroring the constants above, merged into the defines
 * of every shader that integrates geodesics or draws the disc.
 *
 * Spin is deliberately absent: it changes per frame and travels as a uniform,
 * so moving the slider never recompiles a program.
 */
export function glslDefineMap(): Record<string, string> {
  return {
    R_CAPTURE: R_CAPTURE.toFixed(4),
    R_ESCAPE: R_ESCAPE.toFixed(4),
    STEP_K: STEP_K.toFixed(4),
    DT_MIN: DT_MIN.toFixed(4),
    DT_MAX: DT_MAX.toFixed(4),
  };
}
