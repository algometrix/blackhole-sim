/**
 * The property the tidal stream depends on: a particle launched onto the
 * body's orbit at a different radius carries the same specific energy and the
 * same specific angular momentum, so it keeps the body's pericenter and swings
 * back out instead of diving in.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { orbitOf, velocityOnOrbit } from '../orbit';
import { parabolicVelocity } from '../placement';

const RS = 1;

function energyAndMomentum(pos: Vector3, vel: Vector3): { energy: number; momentum: number } {
  const r = pos.length();
  return {
    energy: 0.5 * vel.lengthSq() - RS / 2 / (r - RS),
    momentum: new Vector3().crossVectors(pos, vel).length(),
  };
}

function launchAt(orbitPos: Vector3, orbitVel: Vector3, launchPos: Vector3): Vector3 {
  const orbit = orbitOf(orbitPos, orbitVel, RS);
  const r = launchPos.length();
  const out = { x: 0, y: 0, z: 0 };
  velocityOnOrbit(orbit, launchPos.x / r, launchPos.y / r, launchPos.z / r, r, RS, out);
  return new Vector3(out.x, out.y, out.z);
}

describe('launching onto an orbit', () => {
  it('reproduces the velocity exactly at the launch radius', () => {
    const pos = new Vector3(14, 0, 0);
    const vel = parabolicVelocity(pos, 6.3, RS);
    expect(launchAt(pos, vel, pos).distanceTo(vel)).toBeLessThan(1e-9);
  });

  it('carries the same energy and angular momentum from a different radius', () => {
    const pos = new Vector3(14, 0, 0);
    const vel = parabolicVelocity(pos, 6.3, RS);
    const body = energyAndMomentum(pos, vel);

    // Two body-lengths inward along the strand, which is where the near tip of
    // a stretched star sits.
    const launchPos = new Vector3(10, 0, 0);
    const launchVel = launchAt(pos, vel, launchPos);
    const debris = energyAndMomentum(launchPos, launchVel);

    expect(debris.energy).toBeCloseTo(body.energy, 9);
    expect(debris.momentum).toBeCloseTo(body.momentum, 9);
  });

  it('keeps falling inward while the body is falling inward', () => {
    const pos = new Vector3(14, 0, 0);
    const vel = parabolicVelocity(pos, 6.3, RS);
    const launchPos = new Vector3(11, 0, 0);
    const launchVel = launchAt(pos, vel, launchPos);
    expect(launchVel.dot(launchPos)).toBeLessThan(0);
  });

  it('goes purely tangential where the orbit cannot reach any deeper', () => {
    // At pericenter the radial term is zero, and below it the energy leaves
    // nothing for radial motion; the clamp must not produce a NaN.
    const pos = new Vector3(14, 0, 0);
    const vel = parabolicVelocity(pos, 6.3, RS);
    const launchVel = launchAt(pos, vel, new Vector3(3, 0, 0));
    expect(Number.isFinite(launchVel.length())).toBe(true);
    expect(Math.abs(launchVel.x)).toBeLessThan(1e-6);
  });
});
