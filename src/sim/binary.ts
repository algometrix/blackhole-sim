/**
 * Secondary black hole on a gravitational-wave inspiral.
 *
 * The separation follows the circular-orbit Peters (1964) equation
 * da/dt = -(64/5) m1 m2 (m1+m2) / a^3 (geometric units), with the wall
 * clock compressed by a UI-tunable factor: the trajectory shape (orbits
 * versus separation, chirp profile) is exact, only time is sped up. At
 * contact the pair merges: the primary grows to the total mass minus the
 * energy radiated as gravitational waves, and a short ringdown animates
 * the transition.
 */
import { Vector3 } from 'three';
import { BINARY_TUNING, PLACEMENT_TUNING } from '../config';
import type { BinaryState } from './types';

/** Derive the secondary's world position from (a, angle) on the tilted circle. */
function updatePos(binary: BinaryState): void {
  const inc = BINARY_TUNING.inclination;
  const { a, angle } = binary;
  const s = Math.sin(angle);
  // At angle 0 the secondary sits at (+a, 0, 0) moving toward +z, prograde
  // with the disc's (-z, 0, x) orbital direction.
  binary.pos.set(a * Math.cos(angle), a * s * Math.sin(inc), a * s * Math.cos(inc));
}

/**
 * Create a secondary at the requested planar position, radius clamped to
 * [bh2RMin, rMax], with rs2 = massRatio * primaryRs.
 */
export function createBinary(primaryRs: number, requestedPlanarPos: Vector3): BinaryState {
  const planarR = Math.hypot(requestedPlanarPos.x, requestedPlanarPos.z);
  const a = Math.min(Math.max(planarR, PLACEMENT_TUNING.bh2RMin), PLACEMENT_TUNING.rMax);
  const binary: BinaryState = {
    phase: 'inspiral',
    a,
    angle: Math.atan2(requestedPlanarPos.z, requestedPlanarPos.x),
    rs2: BINARY_TUNING.massRatio * primaryRs,
    pos: new Vector3(),
    ringdownT: 0,
    rsBefore: primaryRs,
    rsFinal: primaryRs,
  };
  updatePos(binary);
  return binary;
}

/**
 * One inspiral tick: shrink the separation by the Peters equation, advance
 * the orbital phase at the Keplerian rate, both compressed in wall time.
 * On contact (a <= primaryRs + rs2) the binary flips to ringdown and the
 * post-merger primary radius is computed; returns mergedNow on that tick.
 */
export function stepBinary(
  binary: BinaryState,
  primaryRs: number,
  dt: number,
  compression: number,
): { mergedNow: boolean } {
  if (binary.phase !== 'inspiral') return { mergedNow: false };
  const m1 = primaryRs / 2;
  const m2 = binary.rs2 / 2;
  const mTotal = m1 + m2;
  const a3 = binary.a ** 3;
  const dadt = (-(64 / 5) * m1 * m2 * mTotal * compression) / a3;
  const omega = Math.sqrt(mTotal / a3) * compression;
  binary.angle += omega * dt;

  const mergeSep = primaryRs + binary.rs2;
  const aNext = binary.a + dadt * dt;
  if (aNext > mergeSep) {
    binary.a = aNext;
    updatePos(binary);
    return { mergedNow: false };
  }

  binary.a = mergeSep;
  updatePos(binary);
  binary.phase = 'ringdown';
  binary.ringdownT = 0;
  binary.rsBefore = primaryRs;
  const eta = (m1 * m2) / (mTotal * mTotal);
  const eRad = BINARY_TUNING.radiatedFractionAtEqualMass * mTotal * (eta / 0.25);
  binary.rsFinal = 2 * (mTotal - eRad);
  return { mergedNow: true };
}

/** Advance the ringdown clock; true once the ring has fully damped (5 tau). */
export function stepRingdown(binary: BinaryState, dt: number): boolean {
  binary.ringdownT += dt;
  return binary.ringdownT > 5 * BINARY_TUNING.ringdownTau;
}

function smoothstep01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The r_s the renderer should draw. During ringdown the shadow grows from
 * rsBefore to rsFinal over the first 0.4 s and "breathes" with a damped
 * oscillation. The breathing wobble is art-directed shorthand for
 * quasi-normal ringing, not a real QNM waveform.
 */
export function displayRs(binary: BinaryState | null, baseRs: number): number {
  if (!binary || binary.phase !== 'ringdown') return baseRs;
  const t = binary.ringdownT;
  const settled = binary.rsBefore + (binary.rsFinal - binary.rsBefore) * smoothstep01(t / 0.4);
  const { ringdownAmplitude, ringdownOmega, ringdownTau } = BINARY_TUNING;
  const wobble = 1 + ringdownAmplitude * Math.exp(-t / ringdownTau) * Math.cos(ringdownOmega * t);
  return settled * wobble;
}

/**
 * Wall-clock orbital angular velocity (for the audio chirp and HUD).
 * Zero once the pair has merged.
 */
export function orbitalOmegaWall(
  binary: BinaryState,
  primaryRs: number,
  compression: number,
): number {
  if (binary.phase !== 'inspiral') return 0;
  const mTotal = primaryRs / 2 + binary.rs2 / 2;
  return Math.sqrt(mTotal / binary.a ** 3) * compression;
}
