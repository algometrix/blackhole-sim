import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createPool, spawnFromBody, updatePool } from '../debris';
import { vCircular } from '../gravity';
import type { Body } from '../types';
import { mulberry32 } from './rng';

const DT = 1 / 60;

function sheddingBody(): Body {
  return {
    kind: 'planet',
    phase: 'shedding',
    mode: 'cinematic',
    pos: new Vector3(5, 0, 0),
    vel: new Vector3(0, 0, 0.85 * vCircular(5)),
    mass: 0.8,
    radius0: 0.3,
    stretch: 3,
    rTidal: 6.0,
    rShed: 4.5,
    lossBase: 0.08,
    energySpread: 0,
    drag: 0.015,
  };
}

/** PW specific energy of particle i (rs = 1). */
function specificEnergy(pool: ReturnType<typeof createPool>, i: number): number {
  const i3 = i * 3;
  const r = Math.hypot(pool.pos[i3]!, pool.pos[i3 + 1]!, pool.pos[i3 + 2]!);
  const v2 = pool.vel[i3]! ** 2 + pool.vel[i3 + 1]! ** 2 + pool.vel[i3 + 2]! ** 2;
  return 0.5 * v2 - 0.5 / (r - 1);
}

describe('debris pool', () => {
  it('spawns from the near-side tip, between the body and the hole', () => {
    const pool = createPool(256);
    const body = sheddingBody();
    const spawned = spawnFromBody(pool, body, 100, 0, mulberry32(1));
    expect(spawned).toBe(100);
    expect(pool.alive).toBe(100);

    const bodyR = body.pos.length();
    let meanR = 0;
    for (let i = 0; i < pool.alive; i++) {
      const i3 = i * 3;
      const r = Math.hypot(pool.pos[i3]!, pool.pos[i3 + 1]!, pool.pos[i3 + 2]!);
      meanR += r;
      const distFromBody = Math.hypot(
        pool.pos[i3]! - body.pos.x,
        pool.pos[i3 + 1]! - body.pos.y,
        pool.pos[i3 + 2]! - body.pos.z,
      );
      expect(distFromBody).toBeLessThan(1.5);
      expect(pool.flags[i]).toBe(1);
    }
    expect(meanR / pool.alive).toBeLessThan(bodyR);
  });

  it('never spawns past capacity', () => {
    const pool = createPool(10);
    expect(spawnFromBody(pool, sheddingBody(), 100, 0, mulberry32(2))).toBe(10);
    expect(pool.alive).toBe(10);
  });

  it('energySpread splits debris into bound (managed) and unbound (ballistic)', () => {
    const pool = createPool(256);
    const body = sheddingBody();
    // Parabolic (zero-energy) pass at r=4, prograde tangential.
    body.pos.set(4, 0, 0);
    body.vel.set(0, 0, Math.sqrt(1 / 3));
    body.radius0 = 0.6;
    spawnFromBody(pool, body, 200, 0, mulberry32(7), { energySpread: 0.35, rs: 1 });
    expect(pool.alive).toBe(200);

    let unbound = 0;
    for (let i = 0; i < pool.alive; i++) {
      const flag = pool.flags[i]!;
      if (flag === 0) unbound++;
      // Flag must agree with the actual PW specific energy.
      const eps = specificEnergy(pool, i);
      expect(flag).toBe(eps < 0 ? 1 : 0);
    }
    const fraction = unbound / pool.alive;
    expect(fraction).toBeGreaterThan(0.2);
    expect(fraction).toBeLessThan(0.8);
  });

  it('a tangentially launched particle spirals inward and settles to the plane', () => {
    const pool = createPool(1);
    pool.alive = 1;
    pool.pos.set([5, 1.5, 0]);
    pool.vel.set([0, 0, vCircular(5)]);
    pool.life[0] = 1;
    pool.flags[0] = 1;

    // Drag is deliberately gentle, a debris orbit has to survive several laps
    //, so the inward spiral shows over hundreds of seconds, not tens.
    const startRadius = Math.hypot(5, 1.5, 0);
    let r = startRadius;
    for (let t = 0; t < 300 && pool.alive > 0; t += DT) {
      updatePool(pool, DT, 0);
      r = Math.hypot(pool.pos[0]!, pool.pos[1]!, pool.pos[2]!);
    }
    expect(r).toBeLessThan(startRadius);
    if (pool.alive > 0) expect(Math.abs(pool.pos[1]!)).toBeLessThan(0.3);
  });

  it('a ballistic particle above escape speed keeps flying outward, undragged', () => {
    const pool = createPool(1);
    pool.alive = 1;
    pool.pos.set([10, 0, 0]);
    const vEscape = Math.sqrt(1 / (10 - 1));
    pool.vel.set([1.2 * vEscape, 0, 0]);
    pool.life[0] = 1;
    pool.flags[0] = 0;

    const eps0 = specificEnergy(pool, 0);
    expect(eps0).toBeGreaterThan(0);
    let r = 10;
    for (let t = 0; t < 5; t += DT) {
      updatePool(pool, DT, 0);
      expect(pool.alive).toBe(1);
      const rNext = Math.hypot(pool.pos[0]!, pool.pos[1]!, pool.pos[2]!);
      expect(rNext).toBeGreaterThan(r);
      r = rNext;
    }
    // No drag: the PW specific energy is conserved (up to integrator error).
    expect(Math.abs(specificEnergy(pool, 0) - eps0)).toBeLessThan(0.005);
  });

  it('absorbs particles at the inner edge and reports them', () => {
    const pool = createPool(1);
    pool.alive = 1;
    pool.pos.set([2.0, 0, 0]);
    pool.vel.set([0, 0, vCircular(2.0)]);
    pool.life[0] = 1;
    pool.flags[0] = 1;

    let absorbedTotal = 0;
    for (let t = 0; t < 10 && pool.alive > 0; t += DT) {
      absorbedTotal += updatePool(pool, DT, 0).absorbed;
    }
    expect(pool.alive).toBe(0);
    expect(absorbedTotal).toBe(1);
  });

  it('the secondary hole swallows nearby particles without disc credit', () => {
    const pool = createPool(1);
    pool.alive = 1;
    pool.pos.set([6, 0, 0]);
    pool.vel.set([0, 0, 0]);
    pool.life[0] = 1;
    pool.flags[0] = 1;

    const env = { rs: 1, bh2: { pos: new Vector3(6.05, 0, 0), m: 0.15 } };
    const { absorbed } = updatePool(pool, DT, 0, env);
    expect(pool.alive).toBe(0);
    expect(absorbed).toBe(0);
  });

  it('keeps arrays packed and finite through churn', () => {
    const pool = createPool(64);
    const body = sheddingBody();
    body.pos.set(3.5, 0.2, 0);
    spawnFromBody(pool, body, 64, 0, mulberry32(3));
    for (let t = 0; t < 40; t += DT) updatePool(pool, DT, 0);
    expect(pool.alive).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < pool.alive * 3; i++) {
      expect(Number.isFinite(pool.pos[i]!)).toBe(true);
      expect(Number.isFinite(pool.vel[i]!)).toBe(true);
    }
  });
});
