/**
 * Relativistic optics of a moving observer, in geometric units where c = 1 so
 * beta is already a fraction of light speed. Pure functions, no THREE, no DOM.
 *
 * `aberrateLookDirection` is the executable specification of `aberratedRay()`
 * in render/shaders/geodesic.frag, the same relationship physics/geodesic.ts
 * already has with the geodesic march. The two are separate copies of one
 * piece of algebra and must be edited together; the tests here are what fails
 * when only one of them is.
 */
import type { Vec3 } from './geodesic';

/**
 * Ceiling on the observer speed the optics are computed from. gamma = 3.2 at
 * 0.95, which is already a violent view, and it keeps 1 - beta^2 away from
 * zero for a plunge that formally reaches light speed at the horizon.
 */
export const MAX_OBSERVER_BETA = 0.95;

export function lorentzGamma(beta: number): number {
  return 1 / Math.sqrt(1 - beta * beta);
}

/**
 * Speed of a circular orbit at radius r, as measured by a static observer
 * there: sqrt(M / (r - 2M)), the same expression `discEmission` uses for the
 * gas (docs/THEORY.md part 9). 0.5 at the ISCO, r = 3 r_s.
 *
 * The denominator is floored rather than allowed to reach zero: there is no
 * circular orbit at the horizon, and a tour that ends up there should read as
 * "as fast as we model", not as a division by zero.
 */
export function circularOrbitBeta(r: number, rs: number): number {
  return Math.min(Math.sqrt((0.5 * rs) / Math.max(r - rs, 0.3)), MAX_OBSERVER_BETA);
}

/**
 * Speed of a body that fell from rest at infinity: sqrt(r_s / r), the escape
 * speed relation of docs/THEORY.md part 3, run backwards. It reaches 1 at the
 * horizon, so it is clamped.
 */
export function freeFallBeta(r: number, rs: number): number {
  return Math.min(Math.sqrt(rs / Math.max(r, 1e-6)), MAX_OBSERVER_BETA);
}

export interface AberratedRay {
  /** The same ray, expressed as a look direction in the static frame. */
  dir: Vec3;
  /** Received / emitted frequency ratio; above 1 looking into the motion. */
  doppler: number;
}

/**
 * Transform a look direction out of the observer's rest frame into the static
 * coordinate frame the raymarch and the sky cubemap live in.
 *
 * Relativistic velocity addition applied to the photon's propagation
 * direction -look, then negated back into a look direction:
 *
 *     dir     = (look/gamma - beta + (gamma/(gamma+1)) (look.beta) beta)
 *               / (1 - look.beta)
 *     doppler = 1 / (gamma (1 - look.beta))
 *
 * `look` must be a unit vector. At rest the whole thing is the identity, and
 * the zero test below makes that exact rather than exact-to-rounding: a
 * `normalize` of an already-unit vector can move it by an ulp, and the
 * promise is that ordinary mouse orbiting renders the same frame it always
 * did. It is a uniform-valued branch in the shader, so it costs nothing.
 */
export function aberrateLookDirection(look: Vec3, beta: Vec3): AberratedRay {
  const beta2 = beta.x * beta.x + beta.y * beta.y + beta.z * beta.z;
  if (beta2 === 0) return { dir: { x: look.x, y: look.y, z: look.z }, doppler: 1 };

  const gamma = 1 / Math.sqrt(Math.max(1 - beta2, 1e-6));
  const lookDotBeta = look.x * beta.x + look.y * beta.y + look.z * beta.z;
  const invDenom = 1 / (1 - lookDotBeta);
  const parallel = (gamma / (gamma + 1)) * lookDotBeta;
  const x = (look.x / gamma - beta.x + parallel * beta.x) * invDenom;
  const y = (look.y / gamma - beta.y + parallel * beta.y) * invDenom;
  const z = (look.z / gamma - beta.z + parallel * beta.z) * invDenom;
  const length = Math.hypot(x, y, z);
  return {
    dir: { x: x / length, y: y / length, z: z / length },
    doppler: invDenom / gamma,
  };
}
