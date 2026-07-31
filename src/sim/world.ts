/**
 * The whole simulation API: create the world, advance it one fixed tick,
 * place or clear a body, place a secondary hole. Orchestrates the binary
 * inspiral, body integration, debris spawning, particle updates, and disc
 * feeding, all pure CPU math.
 */
import { Vector3 } from 'three';
import { BINARY_TUNING, BODY_TUNING, DEBRIS_TUNING, DISC_TUNING, TDE_TUNING } from '../config';
import type { TdeMode } from '../settings';
import { createBinary, stepBinary, stepRingdown } from './binary';
import { spillFraction, stepBody } from './body';
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
  let drag: number;
  let vel: Vector3;
  if (mode === 'realistic') {
    const rt = isStar ? TDE_TUNING.starTidalRadius : TDE_TUNING.planetTidalRadius;
    rTidal = 1.5 * rt;
    rShed = rt;
    lossBase = TDE_TUNING.massLossBase;
    energySpread = TDE_TUNING.energySpread;
    drag = 0;
    vel = parabolicVelocity(pos, TDE_TUNING.pericenterFraction * rt, rs);
  } else {
    rTidal = BODY_TUNING.rTidal;
    rShed = BODY_TUNING.rShed;
    lossBase = BODY_TUNING.massLossBase;
    energySpread = 0;
    drag = BODY_TUNING.drag;
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
    drag,
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
 * Empty the scene: no body, no secondary, no debris, no leftover feeding.
 * A ringdown in progress is settled first, so the primary keeps the mass it
 * gained in the merger instead of snapping back to its pre-merger radius.
 */
export function resetScene(world: World): void {
  if (world.binary?.phase === 'ringdown') world.primaryRs = world.binary.rsFinal;
  world.body = null;
  world.binary = null;
  world.debris.alive = 0;
  world.spawnAcc = 0;
  world.discBoost = 0;
  world.debrisBrightness = 1;
  world.debrisHeatFloor = 0;
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
/**
 * Ceiling on a single body/debris integration step. The body and the debris
 * are integrated numerically (semi-implicit Euler), so a compressed clock has
 * to be walked in substeps, hand the integrator one 1-second jump and the
 * trajectory itself starts to depend on the compression slider.
 */
const MAX_BODY_STEP = 0.1;

/**
 * One tick. Two clocks run inside it:
 *
 * - `gwCompression` for the binary inspiral. Exact: `stepBinary` advances
 *   closed-form Peters and Kepler quantities, so only the clock changes.
 * - `tdeCompression` for the body and its debris. A circular orbit at 12 r_s
 *   takes ~370 time units, so at 1:1 a disruption unfolds over ten minutes and
 *   the debris never completes a turn, the stream reads as a scattering of
 *   dots instead of the wound spiral it is. Substepped to `MAX_BODY_STEP` so
 *   the compressed trajectory matches the uncompressed one.
 *
 * The disc keeps the uncompressed clock: it is a background, and shearing it
 * twenty times faster would turn it into a pinwheel.
 */
export function stepWorld(
  world: World,
  dt: number,
  rng: Rng = Math.random,
  gwCompression: number = BINARY_TUNING.timeCompression,
  tdeCompression = 1,
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

  const bodyDt = dt * tdeCompression;
  const substeps = Math.max(1, Math.ceil(bodyDt / MAX_BODY_STEP));
  const subDt = bodyDt / substeps;
  let absorbed = 0;
  for (let step = 0; step < substeps; step++) {
    const body = world.body;
    if (body) {
      const phaseBefore = body.phase;
      const { consumedNow, escaped } = stepBody(body, subDt, env);
      events.shredNow ||= body.phase === 'shedding' && phaseBefore !== 'shedding';
      const spawnOpts = { energySpread: body.energySpread, rs: world.primaryRs };
      // Particles follow the mass: the full rate while shedding, the ramped
      // spill fraction while the body is only being stretched. (The spill also
      // credits the disc, so a fed disc brightens slightly earlier than the
      // one-body-one-boost normalisation assumes.)
      const spill = body.phase === 'stretching' ? spillFraction(body.pos.length(), body) : 0;
      const rateFraction = body.phase === 'shedding' ? 1 : spill;
      if (rateFraction > 0) {
        world.spawnAcc += spawnRateFor(body.kind) * body.mass * rateFraction * subDt;
        const count = Math.floor(world.spawnAcc);
        if (count > 0) {
          // Debited whether or not the pool had room: the mass left the body
          // either way, and a full pool simply means the oldest debris is
          // still on screen.
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
    absorbed += updatePool(world.debris, subDt, world.debrisHeatFloor, env).absorbed;
  }

  if (absorbed > 0) {
    world.discBoost = creditFeed(world.discBoost, absorbed * world.feedPerParticle);
  }
  world.discBoost = decayBoost(world.discBoost, dt);
  world.time += dt;
  return events;
}
