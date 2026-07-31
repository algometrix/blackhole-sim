/**
 * Per-tick integration of the placed body: orbit, phase ratchet, stretch
 * animation, mass loss, and (in realistic mode) escape of a partially
 * shredded remnant. world.ts turns the returned mass shed into debris
 * particles.
 */
import { Vector3 } from 'three';
import { BODY_TUNING, TDE_TUNING } from '../config';
import { stepOrbit, type GravityEnv } from './gravity';
import { massLossRate, nextPhase, stretchTarget } from './tidal';
import type { Body } from './types';

export interface BodyStepResult {
  /** Mass fraction shed this tick (drives debris spawn rate). */
  massShed: number;
  /** True on the tick the body transitions into `consumed`. */
  consumedNow: boolean;
  /** True when a realistic-mode remnant has flown clear (caller removes it). */
  escaped: boolean;
}

const scratch = new Vector3();

/**
 * What fraction of the full shedding rate a merely *stretching* body spills.
 *
 * Expressed so the absolute rate is always `stretchSpillRate` (ramped by depth
 * past the tidal radius) whatever the mode's shedding rate is: a realistic TDE
 * sheds at 0.9 per second and a cinematic spiral at 0.08, and a fixed fraction
 * of the former would strip the star before it ever reached the shedding
 * radius. This is the thin leader of the stream, not the disruption.
 */
export function spillFraction(r: number, body: Pick<Body, 'rTidal' | 'rShed' | 'lossBase'>): number {
  const span = Math.max(body.rTidal - body.rShed, 1e-6);
  const depth = Math.min(Math.max((body.rTidal - r) / span, 0), 1);
  return Math.min((BODY_TUNING.stretchSpillRate * depth) / Math.max(body.lossBase, 1e-6), 1);
}

export function stepBody(body: Body, dt: number, env: GravityEnv): BodyStepResult {
  if (env.bh2) {
    // Newtonian pull from the secondary hole.
    scratch.copy(body.pos).sub(env.bh2.pos);
    const d = Math.max(scratch.length(), 1e-6);
    body.vel.addScaledVector(scratch, (-env.bh2.m / (d * d * d)) * dt);
  }
  stepOrbit(body.pos, body.vel, dt, body.drag, scratch, env.rs);
  const r = body.pos.length();

  const before = body.phase;
  body.phase = nextPhase(body.phase, r, body.mass, body.rTidal, body.rShed);
  if (r < BODY_TUNING.rConsume * env.rs) body.phase = 'consumed';
  const consumedNow = body.phase === 'consumed' && before !== 'consumed';

  const target = body.phase === 'orbiting' ? 1 : stretchTarget(r, body.rTidal);
  const blend = Math.min(1, dt / BODY_TUNING.stretchSmoothTime);
  body.stretch += (target - body.stretch) * blend;

  // A body does not wait for full disruption to start losing mass. Once tides
  // beat its self-gravity the near tip spills over, and that thin leader, 
  // still-intact body at one end, hole at the other, is the connecting stream
  // every disruption image shows. It ramps up with depth past the tidal radius
  // until the body proper starts coming apart.
  let massShed = 0;
  if (body.phase === 'shedding') {
    massShed = Math.min(body.mass, massLossRate(body.mass, r, body.rShed, body.lossBase) * dt);
  } else if (body.phase === 'stretching') {
    massShed = Math.min(body.mass, massLossRate(body.mass, r, body.rShed, body.lossBase) * dt * spillFraction(r, body));
  }
  body.mass -= massShed;

  const torn = body.phase === 'stretching' || body.phase === 'shedding';
  const escaped =
    body.mode === 'realistic' &&
    torn &&
    r > TDE_TUNING.escapeRadius &&
    body.pos.dot(body.vel) > 0;

  return { massShed, consumedNow, escaped };
}

/** Current visual radius: spawn radius scaled by remaining mass. */
export function bodyRadius(body: Body): number {
  return body.radius0 * Math.cbrt(Math.max(body.mass, 1e-4));
}

/** Axial (toward the hole) and lateral scale factors for the stretched body. */
export function bodyScale(body: Body): { axial: number; lateral: number } {
  const base = Math.cbrt(Math.max(body.mass, 1e-4));
  return {
    axial: base * body.stretch,
    lateral: base / Math.sqrt(body.stretch),
  };
}
