/**
 * Physics constants for a Schwarzschild black hole in geometric units.
 *
 * c = G = 1 and the length unit is the Schwarzschild radius, r_s = 1,
 * so the mass is M = 1/2. The black hole sits at the world origin and the
 * accretion disc lies in the equatorial plane y = 0. Every other module
 * (CPU integrator, GLSL shaders, simulation) reads its numbers from here,
 * which is what keeps the shader image and the CPU photon paths consistent.
 */

/** Schwarzschild radius (the event horizon). */
export const R_S = 1.0;

/** Black hole mass: r_s = 2M with r_s = 1. */
export const M = 0.5;

/** Photon sphere radius, 3M. */
export const R_PHOTON = 1.5;

/** Innermost stable circular orbit, 6M = 3 r_s. Inner edge of the disc. */
export const R_ISCO = 3.0;

/** Outer edge of the accretion disc. */
export const DISC_OUTER = 9.0;

/**
 * Critical impact parameter b_crit = 3*sqrt(3)*M. Rays aimed with b below
 * this are captured; it is also the apparent radius of the shadow.
 */
export const B_CRIT = (3 * Math.sqrt(3)) / 2;

/** Radius beyond which an outward-moving ray is considered escaped. */
export const R_ESCAPE = 40.0;

/** Capture radius, slightly outside the horizon to avoid stiffness at r -> 1. */
export const R_CAPTURE = 1.02;

/** Adaptive step size: dt = clamp(STEP_K * (r - 0.9), DT_MIN, DT_MAX). */
export const STEP_K = 0.15;
export const DT_MIN = 0.02;
export const DT_MAX = 0.35;

/**
 * GLSL `#define` map mirroring the constants above, merged into the defines
 * of every shader that integrates geodesics or draws the disc.
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
