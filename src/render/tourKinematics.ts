/**
 * The flyby's speed profile and its integral. Two views of one idea: the
 * profile says how fast the camera is going, the integral says where it is.
 * Both are used, one to place the camera and one to boost the optics.
 *
 * Deliberately free of THREE so the test does not have to import a renderer.
 */

/**
 * Normalized speed along the flyby at normalized time u: smoothstep up over
 * the first `ramp` fraction, flat through the middle, symmetric down at the
 * end. 0 at both ends, 1 through the middle.
 */
export function runSpeedFraction(u: number, ramp: number): number {
  if (u <= 0 || u >= 1) return 0;
  const x = u < ramp ? u / ramp : u > 1 - ramp ? (1 - u) / ramp : 1;
  return x * x * (3 - 2 * x);
}

/**
 * Normalized distance travelled by normalized time u: the analytic integral of
 * `runSpeedFraction` (integral of smoothstep = x^3 - x^4/2 over a ramp),
 * rescaled so progress(1) = 1. Its derivative is
 * runSpeedFraction(u, ramp) / (1 - ramp).
 */
export function easedRunProgress(u: number, ramp: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const rampArea = (x: number): number => ramp * x * x * x * (1 - x / 2);
  const total = 1 - ramp;
  if (u < ramp) return rampArea(u / ramp) / total;
  if (u <= 1 - ramp) return (ramp / 2 + (u - ramp)) / total;
  return (total - rampArea((1 - u) / ramp)) / total;
}
