/**
 * A tidal stream has to survive as a stream. Debris that is swallowed the
 * first time it dips inside the inner edge never gets to swing back out, and
 * the wound ribbon every disruption image shows never forms, so these are
 * the properties that keep it: the stream outlives the star, it spans a wide
 * range of radii, and it wraps around the hole rather than pointing one way.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createWorld, placeBody, stepWorld } from '../world';
import { mulberry32 } from './rng';

const DT = 1 / 60;
const COMPRESSION = 20;

interface StreamShape {
  count: number;
  minRadius: number;
  maxRadius: number;
  /** Angular span the debris covers around the hole, radians. */
  azimuthSpan: number;
}

function shapeOf(world: ReturnType<typeof createWorld>): StreamShape {
  const pool = world.debris;
  const angles: number[] = [];
  let minRadius = Infinity;
  let maxRadius = 0;
  for (let i = 0; i < pool.alive; i++) {
    const x = pool.pos[i * 3]!;
    const z = pool.pos[i * 3 + 2]!;
    const r = Math.hypot(x, pool.pos[i * 3 + 1]!, z);
    minRadius = Math.min(minRadius, r);
    maxRadius = Math.max(maxRadius, r);
    angles.push(Math.atan2(z, x));
  }
  angles.sort((a, b) => a - b);
  // Widest gap between neighbouring angles; the span is what is left of the
  // circle once that gap is removed.
  let widestGap = angles.length > 1 ? angles[0]! + 2 * Math.PI - angles[angles.length - 1]! : 0;
  for (let i = 1; i < angles.length; i++) {
    widestGap = Math.max(widestGap, angles[i]! - angles[i - 1]!);
  }
  return {
    count: pool.alive,
    minRadius,
    maxRadius,
    azimuthSpan: angles.length > 1 ? 2 * Math.PI - widestGap : 0,
  };
}

function disrupt(ticks: number): StreamShape {
  const world = createWorld();
  const rng = mulberry32(7);
  placeBody(world, 'star', new Vector3(14, 0, 0), 'realistic');
  for (let i = 0; i < ticks; i++) stepWorld(world, DT, { gw: 40, tde: COMPRESSION, beacon: 1 }, rng);
  return shapeOf(world);
}

describe('tidal stream', () => {
  it('survives its first pericenter passage', () => {
    // The star is gone by ~35 disruption-seconds; this is long after.
    const shape = disrupt(600);
    expect(shape.count).toBeGreaterThan(1000);
  });

  it('draws itself out over a wide range of radii', () => {
    const shape = disrupt(600);
    expect(shape.maxRadius - shape.minRadius).toBeGreaterThan(6);
  });

  it('wraps around the hole instead of pointing one way', () => {
    const shape = disrupt(600);
    // Eaten at first pericenter, only the unbound fan is left, and that covers
    // a narrow wedge of sky.
    expect(shape.azimuthSpan).toBeGreaterThan(Math.PI / 2);
  });

  it('is still feeding the hole hundreds of seconds later', () => {
    const late = disrupt(900);
    expect(late.count).toBeGreaterThan(200);
  });
});
