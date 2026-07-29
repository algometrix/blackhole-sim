/**
 * Pure tidal-disruption rules: the phase ratchet, the stretch profile, and
 * the mass-loss rate. Thresholds are parameters because they depend on the
 * body's mode (cinematic vs realistic TDE); no state — body.ts applies
 * these each tick.
 */
import { BODY_TUNING } from '../config';
import type { BodyPhase } from './types';

const PHASE_ORDER: Record<BodyPhase, number> = {
  orbiting: 0,
  stretching: 1,
  shedding: 2,
  consumed: 3,
};

/** Phase implied by the body's current radius and mass alone. */
export function phaseFor(r: number, mass: number, rTidal: number, rShed: number): BodyPhase {
  if (r < BODY_TUNING.rConsume || mass < BODY_TUNING.massConsumed) return 'consumed';
  if (r < rShed) return 'shedding';
  if (r < rTidal) return 'stretching';
  return 'orbiting';
}

/**
 * One-way ratchet: once torn, stays torn, even if an eccentric orbit swings
 * back out past a threshold.
 */
export function nextPhase(
  current: BodyPhase,
  r: number,
  mass: number,
  rTidal: number,
  rShed: number,
): BodyPhase {
  const candidate = phaseFor(r, mass, rTidal, rShed);
  return PHASE_ORDER[candidate] > PHASE_ORDER[current] ? candidate : current;
}

/** Target axial stretch factor at radius r; 1 outside the tidal radius. */
export function stretchTarget(r: number, rTidal: number): number {
  const raw = (rTidal / r) ** BODY_TUNING.stretchExponent;
  return Math.min(Math.max(raw, 1), BODY_TUNING.stretchMax);
}

/**
 * Fractional mass-loss rate (per second) while shedding: faster the deeper
 * the body sits inside the shed radius. Clamped positive so an eccentric
 * swing back outside rShed slows shedding but never reverses it.
 */
export function massLossRate(mass: number, r: number, rShed: number, base: number): number {
  const depth = 1 + (2 * (rShed - r)) / rShed;
  return mass * base * Math.min(Math.max(depth, 0.2), 3);
}
