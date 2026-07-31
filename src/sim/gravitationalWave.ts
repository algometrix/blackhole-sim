/**
 * The gravitational wave the curvature grid draws.
 *
 * The pattern is the real quadrupole solution: two crests per orbit, wound
 * into a trailing spiral by the retarded phase, amplitude growing as 1/a while
 * the pair tightens and falling as 1/r on the way out. Only the propagation
 * speed is art-directed, at light speed under the compressed inspiral clock
 * the crests would sit far below one grid cell.
 *
 * Pure: no rendering, no globals, one state in and one state out.
 */
import { GRID_TUNING } from '../config';
import { orbitalOmegaWall } from './binary';
import type { BinaryState } from './types';

export interface WaveState {
  /** Strain scale; 0 leaves the funnel perfectly still. */
  amplitude: number;
  /** Radial wavenumber of the outgoing wave. */
  wavenumber: number;
  /** Twice the source's orbital phase, accumulated. */
  phase: number;
  /** Angular frequency the last source was orbiting at, for the ringdown. */
  omega: number;
}

export function restingWave(): WaveState {
  return { amplitude: 0, wavenumber: 0, phase: 0, omega: 0 };
}

/**
 * Advance by `dt` simulation seconds. While a binary is inspiraling the wave
 * is driven by its orbit; once nothing is orbiting, the last burst keeps
 * travelling outward at the same frequency and fades.
 */
export function nextWaveState(
  previous: WaveState,
  binary: BinaryState | null,
  primaryRs: number,
  gwCompression: number,
  dt: number,
): WaveState {
  if (binary?.phase === 'inspiral') {
    const omega = orbitalOmegaWall(binary, primaryRs, gwCompression);
    const contactSeparation = primaryRs + binary.rs2;
    return {
      amplitude: GRID_TUNING.waveAmplitude * (contactSeparation / binary.a),
      wavenumber: Math.min((2 * omega) / GRID_TUNING.waveSpeed, GRID_TUNING.maxWavenumber),
      phase: 2 * binary.angle,
      omega,
    };
  }
  return {
    amplitude: previous.amplitude * Math.exp(-dt / GRID_TUNING.waveDecayTau),
    wavenumber: previous.wavenumber,
    phase: previous.phase + 2 * previous.omega * dt,
    omega: previous.omega,
  };
}
