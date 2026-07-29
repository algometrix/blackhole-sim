import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BODY_TUNING, PLACEMENT_TUNING } from '../../config';
import { stepOrbit, vCircular } from '../gravity';
import { clampPlacement, initialVelocity, parabolicVelocity } from '../placement';

const DT = 1 / 60;

describe('placement', () => {
  it('clamps the radius into [rMin, rMax] on the disc plane', () => {
    expect(clampPlacement(new Vector3(2, 5, 0)).length()).toBeCloseTo(PLACEMENT_TUNING.rMin, 6);
    expect(clampPlacement(new Vector3(100, -3, 0)).length()).toBeCloseTo(PLACEMENT_TUNING.rMax, 6);
    const kept = clampPlacement(new Vector3(0, 1, 12));
    expect(kept.length()).toBeCloseTo(12, 6);
    expect(kept.y).toBe(0);
  });

  it('accepts a caller-supplied inner radius (secondary hole placement)', () => {
    const r = clampPlacement(new Vector3(5, 0, 0), PLACEMENT_TUNING.bh2RMin).length();
    expect(r).toBeCloseTo(5, 6);
    expect(
      clampPlacement(new Vector3(1, 0, 0), PLACEMENT_TUNING.bh2RMin).length(),
    ).toBeCloseTo(PLACEMENT_TUNING.bh2RMin, 6);
  });

  it('handles a degenerate request at the origin', () => {
    expect(clampPlacement(new Vector3(0, 0, 0)).length()).toBeCloseTo(PLACEMENT_TUNING.rMin, 6);
  });

  it('launch velocity is tangential, in-plane, prograde, sub-circular', () => {
    const pos = new Vector3(10, 0, 0);
    const vel = initialVelocity(pos);
    expect(vel.dot(pos)).toBeCloseTo(0, 10);
    expect(vel.y).toBe(0);
    // Prograde with the disc's (-z, 0, x) orbital direction: at +x that is +z.
    expect(vel.z).toBeGreaterThan(0);
    expect(vel.length()).toBeCloseTo(BODY_TUNING.launchSpeedFactor * vCircular(10), 10);
  });

  it('parabolicVelocity launches with PW specific energy ~ 0', () => {
    const pos = new Vector3(12, 0, 0);
    const vel = parabolicVelocity(pos, 2.8);
    const eps = 0.5 * vel.lengthSq() - 0.5 / (12 - 1);
    expect(eps).toBeCloseTo(0, 10);
    // Inbound (radial component points at the hole) and prograde.
    expect(vel.dot(pos)).toBeLessThan(0);
    expect(vel.z).toBeGreaterThan(0);
  });

  it('a parabolic orbit from r=12 reaches its pericenter', () => {
    const rPeri = 2.8;
    const pos = new Vector3(12, 0, 0);
    const vel = parabolicVelocity(pos, rPeri);
    const scratch = new Vector3();
    let rMin = 12;
    for (let i = 0; i < 12_000; i++) {
      stepOrbit(pos, vel, DT, 0, scratch);
      rMin = Math.min(rMin, pos.length());
    }
    expect(Math.abs(rMin - rPeri) / rPeri).toBeLessThan(0.2);
  });

  it('rejects a launch point at or inside the horizon', () => {
    expect(() => parabolicVelocity(new Vector3(0.5, 0, 0), 2.8)).toThrow();
    expect(() => parabolicVelocity(new Vector3(12, 0, 0), 0.9)).toThrow();
  });
});
