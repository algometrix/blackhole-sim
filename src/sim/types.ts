/**
 * Simulation state types. The sim layer is pure TypeScript: it may use
 * Three's math classes (Vector3, plain JS, Node-safe) but nothing that
 * touches a renderer, scene, or the DOM.
 */
import { Vector3 } from 'three';
import type { TdeMode } from '../settings';

export type BodyKind = 'planet' | 'star';

/** One-way disruption phases; transitions never regress (see tidal.ts). */
export type BodyPhase = 'orbiting' | 'stretching' | 'shedding' | 'consumed';

export interface Body {
  kind: BodyKind;
  phase: BodyPhase;
  mode: TdeMode;
  pos: Vector3;
  vel: Vector3;
  /** 1.0 at spawn, decays to 0 while shedding. */
  mass: number;
  /** Visual radius at spawn; current radius is radius0 * cbrt(mass). */
  radius0: number;
  /** Axial stretch factor toward the hole, smoothed; 1 = spherical. */
  stretch: number;
  /** Radius where stretching begins (mode/kind dependent). */
  rTidal: number;
  /** Radius where shedding begins. */
  rShed: number;
  /** Base fractional mass-loss rate per second while shedding. */
  lossBase: number;
  /** Debris energy spread (bound/unbound split); 0 in cinematic mode. */
  energySpread: number;
  /**
   * Velocity drag per second. It is what drives the cinematic spiral, and it
   * is exactly zero in realistic mode: a zero-energy parabolic plunge that
   * bleeds velocity on the way in is no longer parabolic, and its pericenter
   * collapses into the hole, taking the debris stream with it.
   */
  drag: number;
}

/** Secondary black hole on a gravitational-wave inspiral (see binary.ts). */
export type BinaryPhase = 'inspiral' | 'ringdown';

export interface BinaryState {
  phase: BinaryPhase;
  /** Orbital separation, r_s units (inspiral only). */
  a: number;
  /** Orbital angle, radians. */
  angle: number;
  /** Secondary Schwarzschild radius (2 * its mass). */
  rs2: number;
  /** Secondary world position, derived each tick. */
  pos: Vector3;
  /** Time since merger, sim-seconds (ringdown only). */
  ringdownT: number;
  /** Primary r_s at merger and the post-merger settled value. */
  rsBefore: number;
  rsFinal: number;
}

/**
 * Structure-of-arrays particle pool, preallocated at capacity. The render
 * layer wraps these exact arrays in BufferAttributes (zero copy); the first
 * `alive` entries are the live particles (swap-remove keeps them packed).
 */
export interface DebrisPool {
  pos: Float32Array;
  vel: Float32Array;
  heat: Float32Array;
  life: Float32Array;
  size: Float32Array;
  age: Float32Array;
  /** 1 = managed/bound (drag, plane settling, disc absorption);
   *  0 = ballistic/unbound (pure gravity, flies away, never feeds the disc). */
  flags: Uint8Array;
  alive: number;
  capacity: number;
}

export interface World {
  time: number;
  /** At most one body at a time; placing a new one replaces it. */
  body: Body | null;
  /** Secondary hole on a GW inspiral, or null when there is none. */
  binary: BinaryState | null;
  /** Primary Schwarzschild radius; 1 initially, grows after a merger. */
  primaryRs: number;
  /**
   * Dimensionless Kerr spin a/M of the primary, prograde with the disc. It is
   * a property of the hole rather than a per-step argument, which is what
   * keeps `stepWorld`'s parameter list from growing again. Forced to 0 while
   * a second hole is in the scene: superposed centers have no Kerr form.
   */
  spin: number;
  debris: DebrisPool;
  /** 0..boostMax; disc brightness multiplier is (1 + discBoost). Decays. */
  discBoost: number;
  /** Fractional particle-spawn accumulator. */
  spawnAcc: number;
  /**
   * Particles emitted per unit of shed mass (set when a body is placed). The
   * spawn rule lives entirely in stepBody's mass loss; this only converts it.
   */
  particlesPerMass: number;
  /** Boost credited per absorbed particle (set when a body is placed). */
  feedPerParticle: number;
  /** Emission brightness for debris spawned by the current body. */
  debrisBrightness: number;
  /** Heat floor for debris spawned by the current body (stars run hot). */
  debrisHeatFloor: number;
}
