/**
 * Accretion-disc feeding: absorbed debris credits a brightness boost that
 * decays exponentially, so the disc flares while being fed and calms after.
 */
import { DISC_TUNING } from '../config';

export function creditFeed(boost: number, amount: number): number {
  return Math.min(boost + amount, DISC_TUNING.boostMax);
}

export function decayBoost(boost: number, dt: number): number {
  return boost * Math.exp(-dt / DISC_TUNING.boostDecayTau);
}
