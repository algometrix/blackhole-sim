import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { TDE_TUNING } from '../../config';
import { createWorld, placeBody, stepWorld } from '../world';
import type { BodyPhase } from '../types';
import { mulberry32 } from './rng';

const DT = 1 / 60;
// Every clock stated explicitly: these tests count sim-seconds, so a default
// compression would silently multiply every duration they assert.
const CLOCKS = { gw: 40, tde: 1, beacon: 1 };

describe('world end-to-end (tuning harness)', () => {
  it('a placed planet is disrupted through the phases and consumed', () => {
    const world = createWorld(16384);
    const rng = mulberry32(42);
    placeBody(world, 'planet', new Vector3(12, 0, 0));

    const firstSeen = new Map<BodyPhase, number>();
    let peakBoost = 0;
    let tick = 0;
    const maxTicks = 400 * 60;
    while (world.body && tick < maxTicks) {
      if (!firstSeen.has(world.body.phase)) firstSeen.set(world.body.phase, tick);
      stepWorld(world, DT, CLOCKS, rng);
      peakBoost = Math.max(peakBoost, world.discBoost);
      tick++;
    }

    expect(world.body).toBeNull();
    expect(firstSeen.get('orbiting')).toBe(0);
    expect(firstSeen.get('stretching')).toBeGreaterThan(0);
    expect(firstSeen.get('shedding')!).toBeGreaterThan(firstSeen.get('stretching')!);
    expect(peakBoost).toBeGreaterThan(0.3);

    // Debris drains and the boost decays after consumption.
    for (let t = 0; t < 40; t += DT) stepWorld(world, DT, CLOCKS, rng);
    expect(world.debris.alive).toBe(0);
    expect(world.discBoost).toBeLessThan(0.05);
  });

  it('a realistic star is shredded near pericenter into bound + unbound debris', () => {
    const world = createWorld(16384);
    const rng = mulberry32(1234);
    placeBody(world, 'star', new Vector3(12, 0, 0), 'realistic');
    expect(world.body!.mode).toBe('realistic');
    expect(world.body!.energySpread).toBeGreaterThan(0);

    let shredTick = -1;
    let shredR = 0;
    let sawBound = false;
    let sawUnbound = false;
    let tick = 0;
    const maxTicks = 120 * 60;
    while (world.body && tick < maxTicks) {
      const { shredNow } = stepWorld(world, DT, CLOCKS, rng);
      if (shredNow && world.body) {
        shredTick = tick;
        shredR = world.body.pos.length();
      }
      for (let i = 0; i < world.debris.alive; i++) {
        if (world.debris.flags[i] === 1) sawBound = true;
        else sawUnbound = true;
      }
      tick++;
    }

    expect(shredTick).toBeGreaterThan(0);
    // Shredding starts as the star crosses its own tidal radius on the way in.
    expect(shredR).toBeGreaterThan(0);
    expect(shredR).toBeLessThan(TDE_TUNING.starShedRadius * 1.05);
    expect(sawBound).toBe(true);
    expect(sawUnbound).toBe(true);
    // The body is gone (consumed or escaped) within 120 sim-seconds.
    expect(world.body).toBeNull();
  });
});
