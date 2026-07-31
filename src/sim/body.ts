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
 * What fraction of the full shedding rate this body is losing right now. One
 * function so the mass debited here and the particles spawned by world.ts can
 * never drift apart.
 *
 * While merely stretching, a body still spills: tides have already beaten its
 * self-gravity at the near tip, and that thin leader (still-intact body at one
 * end, hole at the other) is the connecting stream every disruption image
 * shows. The fraction is scaled by the mode's own shedding rate so the leader
 * comes out at `stretchSpillRate` either way: a realistic TDE sheds at 0.9 per
 * second against a cinematic spiral's 0.08, and a fixed fraction of the former
 * would strip the star before it reached the shedding radius. `massLossRate`
 * then applies its own radial ramp on top, so the leader thickens as the body
 * falls, which is the intent.
 */
export function shedRateFraction(r: number, body: Pick<Body, 'phase' | 'rTidal' | 'rShed' | 'lossBase'>): number {
  if (body.phase === 'shedding') return 1;
  if (body.phase !== 'stretching') return 0;
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

  const fullRate = massLossRate(body.mass, r, body.rShed, body.lossBase);
  const massShed = Math.min(body.mass, fullRate * shedRateFraction(r, body) * dt);
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
