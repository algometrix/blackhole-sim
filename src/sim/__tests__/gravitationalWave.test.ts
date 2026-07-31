import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GRID_TUNING } from '../../config';
import { nextWaveState, restingWave } from '../gravitationalWave';
import type { BinaryState } from '../types';

function inspiralAt(separation: number): BinaryState {
  return {
    phase: 'inspiral',
    a: separation,
    angle: 0.7,
    rs2: 0.3,
    pos: new Vector3(separation, 0, 0),
    ringdownT: 0,
    rsBefore: 1,
    rsFinal: 1,
  };
}

describe('gravitational wave state', () => {
  it('grows as the pair tightens: amplitude scales as 1/a', () => {
    const wide = nextWaveState(restingWave(), inspiralAt(20), 1, 40, 1 / 60);
    const tight = nextWaveState(restingWave(), inspiralAt(5), 1, 40, 1 / 60);
    expect(tight.amplitude / wide.amplitude).toBeCloseTo(4, 6);
  });

  it('caps the wavenumber so crests never alias against the ring spacing', () => {
    // Near contact the orbital frequency diverges; the drawn wavelength must not.
    const wave = nextWaveState(restingWave(), inspiralAt(1.31), 1, 200, 1 / 60);
    expect(wave.wavenumber).toBe(GRID_TUNING.maxWavenumber);
  });

  it('reads the phase straight off the orbit, two crests per turn', () => {
    const binary = inspiralAt(10);
    const wave = nextWaveState(restingWave(), binary, 1, 40, 1 / 60);
    expect(wave.phase).toBeCloseTo(2 * binary.angle, 12);
  });

  it('keeps travelling and fades once nothing is orbiting', () => {
    const emitted = nextWaveState(restingWave(), inspiralAt(6), 1, 40, 1 / 60);
    const after = nextWaveState(emitted, null, 1, 40, GRID_TUNING.waveDecayTau);
    expect(after.amplitude).toBeCloseTo(emitted.amplitude * Math.exp(-1), 6);
    expect(after.phase).toBeGreaterThan(emitted.phase);
    expect(after.wavenumber).toBe(emitted.wavenumber);
  });

  it('settles to silence', () => {
    let wave = nextWaveState(restingWave(), inspiralAt(6), 1, 40, 1 / 60);
    for (let i = 0; i < 200; i++) wave = nextWaveState(wave, null, 1, 40, 0.1);
    expect(wave.amplitude).toBeLessThan(1e-4);
  });
});
