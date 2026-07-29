import { describe, expect, it } from 'vitest';
import { BODY_TUNING } from '../../config';
import { massLossRate, nextPhase, phaseFor, stretchTarget } from '../tidal';

const { rTidal, rShed, massLossBase } = BODY_TUNING;

describe('tidal phase machine', () => {
  it('advances at the exact thresholds', () => {
    expect(phaseFor(rTidal + 0.01, 1, rTidal, rShed)).toBe('orbiting');
    expect(phaseFor(rTidal - 0.01, 1, rTidal, rShed)).toBe('stretching');
    expect(phaseFor(rShed - 0.01, 1, rTidal, rShed)).toBe('shedding');
    expect(phaseFor(BODY_TUNING.rConsume - 0.01, 1, rTidal, rShed)).toBe('consumed');
  });

  it('consumes on mass exhaustion regardless of radius', () => {
    expect(phaseFor(10, BODY_TUNING.massConsumed - 0.001, rTidal, rShed)).toBe('consumed');
  });

  it('never regresses when r swings back out (one-way ratchet)', () => {
    expect(nextPhase('shedding', 10, 1, rTidal, rShed)).toBe('shedding');
    expect(nextPhase('stretching', 10, 1, rTidal, rShed)).toBe('stretching');
    expect(nextPhase('consumed', 10, 1, rTidal, rShed)).toBe('consumed');
    expect(nextPhase('orbiting', 5.5, 1, rTidal, rShed)).toBe('stretching');
  });

  it('respects caller-supplied thresholds (realistic mode uses its own)', () => {
    expect(phaseFor(5, 1, 6, 4)).toBe('stretching');
    expect(phaseFor(5, 1, 4.5, 3)).toBe('orbiting');
    expect(phaseFor(2.9, 1, 4.5, 3)).toBe('shedding');
  });

  it('stretchTarget is 1 outside the tidal radius, monotone inside, clamped', () => {
    expect(stretchTarget(rTidal, rTidal)).toBeCloseTo(1, 6);
    expect(stretchTarget(8, rTidal)).toBe(1);
    expect(stretchTarget(4, rTidal)).toBeGreaterThan(stretchTarget(5, rTidal));
    expect(stretchTarget(1.01, rTidal)).toBe(BODY_TUNING.stretchMax);
  });

  it('massLossRate stays positive even outside rShed (ratchet keeps shedding)', () => {
    expect(massLossRate(1, 8, rShed, massLossBase)).toBeGreaterThan(0);
    expect(massLossRate(1, 2, rShed, massLossBase)).toBeGreaterThan(
      massLossRate(1, 4, rShed, massLossBase),
    );
  });

  it('massLossRate scales with the base rate', () => {
    expect(massLossRate(1, 3, 4.5, 0.9)).toBeCloseTo(massLossRate(1, 3, 4.5, 0.09) * 10, 12);
  });
});
