import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BINARY_TUNING, PLACEMENT_TUNING } from '../../config';
import { createBinary, displayRs, orbitalOmegaWall, stepBinary } from '../binary';
import { createWorld, placeBinary, stepWorld } from '../world';
import { mulberry32 } from './rng';

const DT = 1 / 60;
const COMPRESSION = 300;

describe('binary inspiral (Peters 1964)', () => {
  it('clamps the requested planar radius and derives the position', () => {
    const far = createBinary(1, new Vector3(100, 0, 0));
    expect(far.a).toBeCloseTo(PLACEMENT_TUNING.rMax, 6);
    const near = createBinary(1, new Vector3(0.5, 0, 0.5));
    expect(near.a).toBeCloseTo(PLACEMENT_TUNING.bh2RMin, 6);
    expect(far.pos.length()).toBeCloseTo(far.a, 5);
    expect(far.rs2).toBeCloseTo(BINARY_TUNING.massRatio, 6);
  });

  it('separation shrinks monotonically and the decay accelerates (chirp)', () => {
    const binary = createBinary(1, new Vector3(6, 0, 0));
    let prevA = binary.a;
    let firstStep = 0;
    let lastStep = 0;
    let merged = false;
    for (let i = 0; i < 10_000 && !merged; i++) {
      merged = stepBinary(binary, 1, DT, COMPRESSION).mergedNow;
      const da = prevA - binary.a;
      expect(binary.a).toBeLessThanOrEqual(prevA);
      if (i === 0) firstStep = da;
      if (!merged) lastStep = da;
      // The secondary stays on the shrinking circle.
      expect(binary.pos.length()).toBeCloseTo(binary.a, 4);
      prevA = binary.a;
    }
    expect(merged).toBe(true);
    expect(lastStep).toBeGreaterThan(firstStep);
  });

  it('the wall-clock orbital rate rises as the pair tightens', () => {
    const binary = createBinary(1, new Vector3(6, 0, 0));
    const omega0 = orbitalOmegaWall(binary, 1, COMPRESSION);
    for (let i = 0; i < 50; i++) stepBinary(binary, 1, DT, COMPRESSION);
    expect(orbitalOmegaWall(binary, 1, COMPRESSION)).toBeGreaterThan(omega0);
  });

  it('merger conserves most of the mass: rsFinal in (rsBefore, rsBefore + rs2)', () => {
    const binary = createBinary(1, new Vector3(6, 0, 0));
    let merged = false;
    for (let i = 0; i < 10_000 && !merged; i++) {
      merged = stepBinary(binary, 1, DT, COMPRESSION).mergedNow;
    }
    expect(merged).toBe(true);
    expect(binary.phase).toBe('ringdown');
    expect(binary.rsFinal).toBeGreaterThan(binary.rsBefore);
    expect(binary.rsFinal).toBeLessThan(binary.rsBefore + binary.rs2);
  });

  it('displayRs settles to rsFinal after the ringdown wobble damps', () => {
    const binary = createBinary(1, new Vector3(6, 0, 0));
    let merged = false;
    for (let i = 0; i < 10_000 && !merged; i++) {
      merged = stepBinary(binary, 1, DT, COMPRESSION).mergedNow;
    }
    expect(displayRs(null, 1)).toBe(1);
    binary.ringdownT = 100 * BINARY_TUNING.ringdownTau;
    expect(displayRs(binary, 1)).toBeCloseTo(binary.rsFinal, 4);
  });

  it('stepWorld runs merger and ringdown to completion, growing the primary', () => {
    const world = createWorld(64);
    const rng = mulberry32(11);
    placeBinary(world, new Vector3(6, 0, 0));
    expect(world.binary).not.toBeNull();

    let mergers = 0;
    let rsFinal = 0;
    for (let i = 0; i < 10_000 && world.binary; i++) {
      const { mergerNow } = stepWorld(world, DT, { gw: COMPRESSION, tde: 1, beacon: 1 }, rng);
      if (mergerNow) {
        mergers++;
        rsFinal = world.binary!.rsFinal;
      }
    }
    expect(mergers).toBe(1);
    expect(world.binary).toBeNull();
    expect(world.primaryRs).toBeCloseTo(rsFinal, 10);
    expect(world.primaryRs).toBeGreaterThan(1);
  });
});
