/**
 * Debris particle pool. Two populations share the pool, distinguished by a
 * per-particle flag:
 *
 * - managed/bound (flag 1): spiral in under PW gravity + drag, settle into
 *   the disc plane, heat up, and get absorbed at the disc's inner edge.
 * - ballistic/unbound (flag 0): pure gravity, no drag or settling; they fly
 *   away and are culled far out, never feeding the disc. Realistic TDEs
 *   eject roughly half the debris this way.
 *
 * Pure CPU math over packed structure-of-arrays buffers; the render layer
 * draws these arrays directly.
 *
 * In-range typed-array reads use `!` because noUncheckedIndexedAccess cannot
 * see the `i < alive <= capacity` invariant.
 */
import { DEBRIS_TUNING } from '../config';
import { vCircular, type GravityEnv } from './gravity';
import { bodyRadius } from './body';
import type { Body, DebrisPool } from './types';

/** Injectable randomness so spawn logic is testable deterministically. */
export type Rng = () => number;

/** Ballistic particles are culled once they are clearly gone. */
const BALLISTIC_CULL_RADIUS = 60;

const DEFAULT_ENV: GravityEnv = { rs: 1, bh2: null };

export function createPool(capacity: number): DebrisPool {
  return {
    pos: new Float32Array(capacity * 3),
    vel: new Float32Array(capacity * 3),
    heat: new Float32Array(capacity),
    life: new Float32Array(capacity),
    size: new Float32Array(capacity),
    age: new Float32Array(capacity),
    flags: new Uint8Array(capacity),
    alive: 0,
    capacity,
  };
}

/** Standard normal via Box–Muller. */
function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function heatAt(r: number, floor: number): number {
  const { heatOuterR, heatInnerR } = DEBRIS_TUNING;
  const raw = (heatOuterR - r) / (heatOuterR - heatInnerR);
  return Math.max(floor, Math.min(Math.max(raw, 0), 1));
}

export interface SpawnOptions {
  /** Radial energy kick as a fraction of local circular speed; 0 = cinematic. */
  energySpread?: number;
  /** Primary Schwarzschild radius. */
  rs?: number;
}

/**
 * Spawn `count` particles from the disrupting body.
 *
 * energySpread = 0 (cinematic): all from the near-side (hole-facing) tip,
 * inheriting the body's velocity plus a small kick toward the hole; every
 * particle is managed (flag 1).
 *
 * energySpread > 0 (realistic TDE): alternate between the near tip (kicked
 * inward, more bound) and the far tip (kicked outward, less bound), then set
 * the flag from the PW specific energy eps = |v|^2/2 - (rs/2)/(r - rs):
 * bound (eps < 0) debris is managed, unbound debris is ballistic. This
 * reproduces the real TDE result that roughly half the debris escapes.
 *
 * Returns the number actually spawned (pool may fill up).
 */
export function spawnFromBody(
  pool: DebrisPool,
  body: Body,
  count: number,
  heatFloor: number,
  rng: Rng,
  opts: SpawnOptions = {},
): number {
  const energySpread = opts.energySpread ?? 0;
  const rs = opts.rs ?? 1;
  const { spawnJitter, spawnKick, pointSize } = DEBRIS_TUNING;
  const bp = body.pos;
  const r = bp.length();
  const radius = bodyRadius(body);
  // Unit vector from body toward the hole (origin).
  const inv = 1 / Math.max(r, 1e-6);
  const dx = -bp.x * inv;
  const dy = -bp.y * inv;
  const dz = -bp.z * inv;
  const tip = 0.9 * radius * body.stretch;
  const vCirc = vCircular(Math.max(r, 1.5 * rs), rs);
  const cinematicKick = spawnKick * vCirc;

  // The star's orbit, as an orbit rather than as one velocity vector: its
  // specific energy, its angular momentum, and the direction it is swinging.
  // Debris is launched *onto this orbit* at its own radius. Copying the
  // velocity vector instead gives a particle displaced a body-length inward
  // the same speed but far less angular momentum, so the near half of every
  // stream dives into the hole rather than swinging back out, the ribbon
  // never forms.
  const starSpeedSq = body.vel.lengthSq();
  const starEnergy = 0.5 * starSpeedSq - rs / 2 / Math.max(r - rs, 1e-3);
  const radialSpeed = body.vel.x * -dx + body.vel.y * -dy + body.vel.z * -dz;
  const tanX = body.vel.x - radialSpeed * -dx;
  const tanY = body.vel.y - radialSpeed * -dy;
  const tanZ = body.vel.z - radialSpeed * -dz;
  const tanSpeed = Math.max(Math.hypot(tanX, tanY, tanZ), 1e-9);
  const tux = tanX / tanSpeed;
  const tuy = tanY / tanSpeed;
  const tuz = tanZ / tanSpeed;
  const angularMomentum = r * tanSpeed;
  const infalling = radialSpeed < 0 ? -1 : 1;
  // Jitter across the strand, which is thin: a stretched body conserves
  // volume, so its lateral radius shrinks as 1/sqrt(stretch).
  const jitter = (spawnJitter * radius) / Math.sqrt(body.stretch);

  let spawned = 0;
  for (let n = 0; n < count; n++) {
    if (pool.alive >= pool.capacity) break;
    const i = pool.alive++;
    const i3 = i * 3;

    // Alternate tips in realistic mode; cinematic always uses the near tip.
    const nearTip = energySpread === 0 || n % 2 === 0;
    const side = nearTip ? 1 : -1;
    // Material peels off all along the outer half of the strand, not from a
    // single point at its tip: launching from one point makes particles appear
    // out of nowhere a body-length away instead of streaming off the ribbon.
    const alongStrand = 0.45 + 0.55 * rng();
    // Cinematic mode: a fixed nudge toward the hole, aimed radially.
    //
    // Realistic mode: the tidal energy spread, aimed radially and rising
    // smoothly along the strand. Radial matters, a radial kick leaves the
    // angular momentum untouched, so the debris keeps the star's pericenter
    // and swings back out. Kicking along the direction of motion instead
    // strips angular momentum too, and most of the bound half falls straight
    // down the hole instead of forming a returning stream.
    //
    // While the star is falling inward (v·r̂ < 0), an outward kick cancels
    // part of that infall and *lowers* the specific energy: the near tip ends
    // up bound hardest and returns first, the far tip gains energy and leaves.
    // `boundFlag` then reads the energy back out to split the two populations.
    const spread = energySpread * vCirc * alongStrand * (0.85 + 0.3 * rng());
    const kx = energySpread === 0 ? dx * cinematicKick : -side * dx * spread;
    const ky = energySpread === 0 ? dy * cinematicKick : -side * dy * spread;
    const kz = energySpread === 0 ? dz * cinematicKick : -side * dz * spread;

    const along = tip * alongStrand;
    const px = bp.x + side * dx * along + gaussian(rng) * jitter;
    const py = bp.y + side * dy * along + gaussian(rng) * jitter;
    const pz = bp.z + side * dz * along + gaussian(rng) * jitter;

    // Same orbit, evaluated at this particle's radius: angular momentum sets
    // the tangential speed, energy sets the total, the difference is radial.
    const rp = Math.max(Math.hypot(px, py, pz), 1.05 * rs);
    const tangential = angularMomentum / rp;
    const totalSq = 2 * (starEnergy + rs / 2 / Math.max(rp - rs, 1e-3));
    const radial = infalling * Math.sqrt(Math.max(totalSq - tangential * tangential, 0));
    const rux = px / rp;
    const ruy = py / rp;
    const ruz = pz / rp;
    const vx = tux * tangential + rux * radial + kx + gaussian(rng) * 0.01;
    const vy = tuy * tangential + ruy * radial + ky + gaussian(rng) * 0.01;
    const vz = tuz * tangential + ruz * radial + kz + gaussian(rng) * 0.01;
    pool.pos[i3] = px;
    pool.pos[i3 + 1] = py;
    pool.pos[i3 + 2] = pz;
    pool.vel[i3] = vx;
    pool.vel[i3 + 1] = vy;
    pool.vel[i3 + 2] = vz;
    pool.heat[i] = heatAt(r, heatFloor);
    pool.life[i] = 1;
    pool.age[i] = 0;
    pool.size[i] = pointSize * (0.7 + 0.6 * rng());
    pool.flags[i] = energySpread === 0 ? 1 : boundFlag(px, py, pz, vx, vy, vz, rs);
    spawned++;
  }
  return spawned;
}

/** 1 when the PW specific energy at (pos, vel) is negative (bound). */
function boundFlag(
  px: number,
  py: number,
  pz: number,
  vx: number,
  vy: number,
  vz: number,
  rs: number,
): 0 | 1 {
  const rp = Math.hypot(px, py, pz);
  if (rp <= rs) return 1; // Inside the horizon radius: as bound as it gets.
  const eps = 0.5 * (vx * vx + vy * vy + vz * vz) - (rs / 2) / (rp - rs);
  return eps < 0 ? 1 : 0;
}

function swapRemove(pool: DebrisPool, i: number): void {
  const last = --pool.alive;
  if (i === last) return;
  const i3 = i * 3;
  const l3 = last * 3;
  pool.pos[i3] = pool.pos[l3]!;
  pool.pos[i3 + 1] = pool.pos[l3 + 1]!;
  pool.pos[i3 + 2] = pool.pos[l3 + 2]!;
  pool.vel[i3] = pool.vel[l3]!;
  pool.vel[i3 + 1] = pool.vel[l3 + 1]!;
  pool.vel[i3 + 2] = pool.vel[l3 + 2]!;
  pool.heat[i] = pool.heat[last]!;
  pool.life[i] = pool.life[last]!;
  pool.size[i] = pool.size[last]!;
  pool.age[i] = pool.age[last]!;
  pool.flags[i] = pool.flags[last]!;
}

export interface PoolStepResult {
  /** Particles that died at the disc's inner edge this tick (feed the disc). */
  absorbed: number;
}

/**
 * Advance every particle one tick, compacting the pool with swap-remove so
 * the first `alive` entries stay packed.
 *
 * Managed particles get PW gravity, inspiral drag, disc-plane settling, an
 * absorption fade at the inner edge (absorbRadius * rs), and a hard kill at
 * killRadius * rs. Ballistic particles get gravity only and die far out
 * (r > 60), at max age, or inside the capture radius, never absorbed.
 * Any particle that strays inside 1.05x the secondary hole's Schwarzschild
 * radius is swallowed by it: killed with no disc credit.
 */
export function updatePool(
  pool: DebrisPool,
  dt: number,
  heatFloor: number,
  env: GravityEnv = DEFAULT_ENV,
): PoolStepResult {
  const { drag, planeSpring, planeDamping, absorbFadeTime, maxAge, circularizedSpeedFactor } =
    DEBRIS_TUNING;
  const rs = env.rs;
  const bh2 = env.bh2;
  const bh2CaptureR = bh2 ? 1.05 * 2 * bh2.m : 0;
  const absorbRadius = DEBRIS_TUNING.absorbRadius * rs;
  const killRadius = DEBRIS_TUNING.killRadius * rs;
  const dragFactor = 1 - drag * dt;
  let absorbed = 0;

  let i = 0;
  while (i < pool.alive) {
    const i3 = i * 3;
    const px = pool.pos[i3]!;
    const py = pool.pos[i3 + 1]!;
    const pz = pool.pos[i3 + 2]!;
    const r = Math.hypot(px, py, pz);
    const managed = pool.flags[i] === 1;

    // PW gravity toward the origin.
    const d = Math.max(r - rs, 0.02 * rs);
    const g = -(rs / 2) / (d * d * Math.max(r, 1e-6));
    let ax = g * px;
    let ay = g * py;
    let az = g * pz;

    // Newtonian pull from the secondary hole, which also swallows whatever
    // comes too close (no disc credit for that).
    let captured = false;
    if (bh2) {
      const sx = px - bh2.pos.x;
      const sy = py - bh2.pos.y;
      const sz = pz - bh2.pos.z;
      const dist = Math.max(Math.hypot(sx, sy, sz), 1e-6);
      captured = dist < bh2CaptureR;
      const k = -bh2.m / (dist * dist * dist);
      ax += k * sx;
      ay += k * sy;
      az += k * sz;
    }

    if (managed) {
      // Settle toward the disc plane, ramping up as the particle approaches it.
      const settleW =
        Math.min(Math.max((absorbRadius * 1.5 - r) / (absorbRadius * 1.5), 0), 1) + 0.15;
      ay += (-py * planeSpring - pool.vel[i3 + 1]! * planeDamping) * settleW;
    }

    // Semi-implicit Euler; drag applies to managed particles only.
    const f = managed ? dragFactor : 1;
    const vx = (pool.vel[i3]! + ax * dt) * f;
    const vy = (pool.vel[i3 + 1]! + ay * dt) * f;
    const vz = (pool.vel[i3 + 2]! + az * dt) * f;
    pool.vel[i3] = vx;
    pool.vel[i3 + 1] = vy;
    pool.vel[i3 + 2] = vz;
    pool.pos[i3] = px + vx * dt;
    pool.pos[i3 + 1] = py + vy * dt;
    pool.pos[i3 + 2] = pz + vz * dt;

    pool.age[i] = pool.age[i]! + dt;
    pool.heat[i] = heatAt(r, heatFloor);

    // Debris joins the disc when it *circularizes*, not the first time it
    // crosses the inner edge. A freshly torn stream is violently eccentric: it
    // whips through pericenter and straight back out, and that return swing is
    // the wide ribbon wrapping the hole in every observed disruption image.
    // Swallowing everything that dipped inside the ISCO ate the ribbon before
    // it could form.
    //
    // The test is speed, not radial motion: radial velocity passes through
    // zero at every pericenter no matter how eccentric the orbit is, while a
    // particle whipping through pericenter is moving far faster than the local
    // circular speed. Only material that has shed that excess, by drag, over
    // several passes, is taken.
    if (managed && r < absorbRadius) {
      const circular = vCircular(Math.max(r, 1.5 * rs), rs);
      const speedSq = vx * vx + vy * vy + vz * vz;
      if (speedSq < circularizedSpeedFactor * circular * circular) {
        pool.life[i] = pool.life[i]! - dt / absorbFadeTime;
      }
    }

    const dead = managed
      ? captured || r < killRadius || pool.life[i]! <= 0 || pool.age[i]! > maxAge
      : captured || r < killRadius || r > BALLISTIC_CULL_RADIUS || pool.age[i]! > maxAge;
    if (!dead) {
      i++;
      continue;
    }
    if (managed && !captured && r < absorbRadius * 1.2) absorbed++;
    swapRemove(pool, i);
    // Do not advance i: the swapped-in particle still needs this tick.
  }
  return { absorbed };
}
