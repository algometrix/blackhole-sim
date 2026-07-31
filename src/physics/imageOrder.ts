/**
 * Image order: how many half turns light made around the hole before it
 * reached the camera. Pure functions, no THREE, no DOM.
 *
 * The classifier is the winding angle Phi, the angle swept by the position
 * vector along the ray, and not a count of equatorial-plane crossings: a
 * perfectly straight, unlensed ray from a camera above the plane crosses the
 * plane once, so a crossing counter calls it a first-order image. Winding does
 * not have that failure.
 *
 * For a camera at elevation eps above the disc plane the direct image of the
 * disc spans Phi in [eps, pi - eps] and the first-order image spans
 * [pi + eps, 2pi - eps], so the boundaries at multiples of pi sit in the
 * middle of a gap of width 2*eps. The margin is the camera elevation itself,
 * which is why an exactly edge-on view is the one degenerate case.
 *
 * Winding is measured about the primary hole only. With a second hole in the
 * scene the ray no longer stays in one plane and the count is indicative
 * rather than exact.
 */
import type { Vec3 } from './geodesic';

/**
 * Highest order that gets its own colour. The shader selects among three
 * tints with two mixes, so anything at or past two half turns shares one.
 */
export const IMAGE_ORDER_MAX = 2;

/**
 * Angle swept between two successive positions on a ray, small-angle form:
 * |from x to| / (|from| |to|) rather than an acos, because it costs a cross
 * product instead of an inverse trig call and the march never takes a large
 * step in angle.
 *
 * The error budget is tied to the step clamp. The angle swept in one step is
 * at most dt/r, and dt = clamp(STEP_K * (r - 0.9 r_h), DT_MIN, DT_MAX) forces
 * r >= 3.2 before dt can reach DT_MAX, so dt/r peaks near 0.11 rad, where
 * sin(t) understates t by 2.3e-4. Raise STEP_K or DT_MAX and that bound has to
 * be rechecked, here and in the identical expression in shaders/kerr.glsl.
 *
 * Scale invariant in both arguments, so the caller feeds raw positions.
 */
export function sweptAngle(from: Vec3, to: Vec3): number {
  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  const lengths = Math.hypot(from.x, from.y, from.z) * Math.hypot(to.x, to.y, to.z);
  if (lengths <= 0) return 0;
  return Math.hypot(cx, cy, cz) / lengths;
}

/**
 * Image order from an accumulated winding angle: 0 is the direct view, 1 is
 * light that came round the far side once, 2 and beyond is the photon ring.
 * A boundary belongs to the higher order.
 */
export function imageOrder(windingAngle: number): number {
  return Math.min(Math.floor(windingAngle / Math.PI), IMAGE_ORDER_MAX);
}
