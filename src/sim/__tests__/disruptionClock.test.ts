/**
 * The disruption clock claims to compress wall time without changing the
 * trajectory. That only holds because stepWorld substeps the integrator, so
 * this is the test that keeps the claim honest.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createWorld, placeBody, stepWorld } from '../world';

const DT = 1 / 60;

function runFor(ticks: number, compression: number): Vector3 {
  const world = createWorld(4096);
  placeBody(world, 'star', new Vector3(12, 0, 0), 'cinematic');
  // A fixed generator keeps debris spawning identical between the two runs.
  let seed = 1;
  const rng = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < ticks; i++) stepWorld(world, DT, rng, 40, compression);
  return world.body!.pos.clone();
}

describe('disruption time compression', () => {
  it('lands the body in the same place whether the clock is fast or slow', () => {
    const slow = runFor(1200, 1);
    const fast = runFor(60, 20); // same 20 simulated seconds
    expect(fast.distanceTo(slow)).toBeLessThan(0.05 * slow.length());
  });

  it('advances 20x further per tick than the uncompressed clock', () => {
    const oneTickSlow = runFor(1, 1);
    const oneTickFast = runFor(1, 20);
    const start = new Vector3(12, 0, 0);
    expect(oneTickFast.distanceTo(start)).toBeGreaterThan(
      10 * oneTickSlow.distanceTo(start),
    );
  });
});
