/**
 * The whole simulation API: create the world, advance it one fixed tick,
 * place or clear a body, place a secondary hole. Orchestrates the binary
 * inspiral, body integration, debris spawning, particle updates, and disc
 * feeding — all pure CPU math.
 */
import { Vector3 } from 'three';
import { BINARY_TUNING, BODY_TUNING, DEBRIS_TUNING, DISC_TUNING, TDE_TUNING } from '../config';
import type { TdeMode } from '../settings';
import { createBinary, stepBinary, stepRingdown } from './binary';
import { stepBody } from './body';
import { createPool, spawnFromBody, updatePool, type Rng } from './debris';
import { creditFeed, decayBoost } from './disc';
import type { GravityEnv } from './gravity';
import { clampPlacement, initialVelocity, parabolicVelocity } from './placement';
import type { BodyKind, World } from './types';

/** One-tick events the caller (UI, audio) reacts to. */
export interface WorldEvents {
  /** The binary merged this tick. */
  mergerNow: boolean;
  /** The body first entered `shedding` this tick. */
  shredNow: boolean;
  /** A realistic-mode remnant escaped and was removed this tick. */
  bodyEscaped: boolean;
}

export function createWorld(maxParticles: number = DEBRIS_TUNING.maxParticles): World {
  return {
    time: 0,
    body: null,
    binary: null,
    primaryRs: 1,
    debris: createPool(maxParticles),
    discBoost: 0,
    spawnAcc: 0,
    feedPerParticle: 0,
    debrisBrightness: 1,
    debrisHeatFloor: 0,
  };
}

function spawnRateFor(kind: BodyKind): number {
  return kind === 'star' ? DEBRIS_TUNING.spawnRateStar : DEBRIS_TUNING.spawnRatePlanet;
}

/**
 * Place (or replace) the body at `requested`, clamped to the allowed ring.
 * Cinematic mode launches on a sub-circular prograde spiral with the
 * art-directed disruption thresholds; realistic mode launches on a
 * zero-energy parabolic plunge with mode/kind-specific tidal radii and an
 * energy spread that splits the debris into bound and unbound halves.
 * Existing debris keeps draining; the spawn accumulator resets.
 */
export function placeBody(
  world: World,
  kind: BodyKind,
  requested: Vector3,
  mode: TdeMode = 'cinematic',
): void {
  const pos = clampPlacement(requested);
  const isStar = kind === 'star';
  const rs = world.primaryRs;

  let rTidal: number;
  let rShed: number;
  let lossBase: number;
  let energySpread: number;
  let vel: Vector3;
  if (mode === 'realistic') {
    const rt = isStar ? TDE_TUNING.starTidalRadius : TDE_TUNING.planetTidalRadius;
    rTidal = 1.5 * rt;
    rShed = rt;
    lossBase = TDE_TUNING.massLossBase;
    energySpread = TDE_TUNING.energySpread;
    vel = parabolicVelocity(pos, TDE_TUNING.pericenterFraction * rt, rs);
  } else {
    rTidal = BODY_TUNING.rTidal;
    rShed = BODY_TUNING.rShed;
    lossBase = BODY_TUNING.massLossBase;
    energySpread = 0;
    vel = initialVelocity(pos, rs);
  }

  world.body = {
    kind,
    phase: 'orbiting',
    mode,
    pos,
    vel,
    mass: 1,
    radius0: isStar ? BODY_TUNING.starRadius : BODY_TUNING.planetRadius,
    stretch: 1,
    rTidal,
    rShed,
    lossBase,
    energySpread,
  };
  world.spawnAcc = 0;
  // Normalize feeding so one fully absorbed body credits ~boostPerBody:
  // shedding lasts roughly 1/lossBase seconds at full rate.
  const expectedParticles = spawnRateFor(kind) / lossBase;
  world.feedPerParticle = DISC_TUNING.boostPerBody / expectedParticles;
  world.debrisBrightness = isStar ? DEBRIS_TUNING.starBrightness : DEBRIS_TUNING.planetBrightness;
  world.debrisHeatFloor = isStar ? DEBRIS_TUNING.starHeatFloor : 0;
}

/** Remove the body immediately; its already-shed debris keeps draining. */
export function clearBody(world: World): void {
  world.body = null;
}

/**
 * Place (or replace) the secondary hole. If a ringdown is still playing,
 * settle it first so the new binary orbits the fully grown primary.
 */
export function placeBinary(world: World, requested: Vector3): void {
  if (world.binary?.phase === 'ringdown') {
    world.primaryRs = world.binary.rsFinal;
  }
  world.binary = createBinary(world.primaryRs, requested);
}

/** Advance the world by one fixed timestep `dt` (sim seconds). */
export function stepWorld(
  world: World,
  dt: number,
  rng: Rng = Math.random,
  gwCompression: number = BINARY_TUNING.timeCompression,
): WorldEvents {
  const events: WorldEvents = { mergerNow: false, shredNow: false, bodyEscaped: false };

  const binary = world.binary;
  if (binary?.phase === 'inspiral') {
    events.mergerNow = stepBinary(binary, world.primaryRs, dt, gwCompression).mergedNow;
  } else if (binary?.phase === 'ringdown' && stepRingdown(binary, dt)) {
    world.primaryRs = binary.rsFinal;
    world.binary = null;
  }

  const env: GravityEnv = {
    rs: world.primaryRs,
    bh2:
      world.binary?.phase === 'inspiral'
        ? { pos: world.binary.pos, m: world.binary.rs2 / 2 }
        : null,
  };

  const body = world.body;
  if (body) {
    const phaseBefore = body.phase;
    const { consumedNow, escaped } = stepBody(body, dt, env);
    events.shredNow = body.phase === 'shedding' && phaseBefore !== 'shedding';
    const spawnOpts = { energySpread: body.energySpread, rs: world.primaryRs };
    if (body.phase === 'shedding') {
      world.spawnAcc += spawnRateFor(body.kind) * body.mass * dt;
      const count = Math.floor(world.spawnAcc);
      if (count > 0) {
        world.spawnAcc -= count;
        spawnFromBody(world.debris, body, count, world.debrisHeatFloor, rng, spawnOpts);
      }
    }
    if (consumedNow) {
      spawnFromBody(world.debris, body, DEBRIS_TUNING.burstCount, world.debrisHeatFloor, rng, spawnOpts);
      world.body = null;
    } else if (escaped) {
      world.body = null;
      events.bodyEscaped = true;
    }
  }

  const { absorbed } = updatePool(world.debris, dt, world.debrisHeatFloor, env);
  if (absorbed > 0) {
    world.discBoost = creditFeed(world.discBoost, absorbed * world.feedPerParticle);
  }
  world.discBoost = decayBoost(world.discBoost, dt);
  world.time += dt;
  return events;
}
