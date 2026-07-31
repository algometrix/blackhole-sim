import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BEACON_TUNING, PLACEMENT_TUNING } from '../../config';
import { B_CRIT, R_PHOTON } from '../../physics/constants';
import {
  advanceHorizonGap,
  apparentImageRadius,
  coordinateInfallRate,
  gravitationalRedshift,
  infallEnergy,
  localInfallSpeed,
  localSpeedGrowth,
  observeBeacon,
  observedRedshift,
  properTimeAtHorizon,
  properTimeSinceRelease,
  recessionDoppler,
  releasePoint,
} from '../beacon';
import { createWorld, placeBeacon, placeBinary, stepWorld } from '../world';

const RS = 1;

/**
 * The redshift built the way the physics reads rather than the way it is
 * evaluated: the static gravitational factor times the recession Doppler of
 * the probe's local speed. `observedRedshift` uses an algebraically identical
 * closed form that survives near the horizon, and this is what it has to
 * agree with everywhere the product is still meaningful in float64.
 */
function factorisedRedshift(gap: number, r0: number, rs: number): number {
  return gravitationalRedshift(gap, rs) * recessionDoppler(localInfallSpeed(gap, r0, rs));
}

/**
 * Proper time from r up to r0 by direct quadrature of dtau = dr / sqrt(E^2 - f),
 * substituting u = sqrt(r0 - r) to remove the inverse-square-root endpoint. An
 * independent check on the cycloid closed form: different variable, plain
 * Simpson, no shared algebra.
 */
function integratedProperTime(r: number, r0: number, rs: number): number {
  const uMax = Math.sqrt(r0 - r);
  const steps = 20000;
  const h = uMax / steps;
  const integrand = (u: number): number => 2 * Math.sqrt(((r0 - u * u) * r0) / rs);
  let sum = integrand(0) + integrand(uMax);
  for (let i = 1; i < steps; i++) {
    sum += integrand(i * h) * (i % 2 === 1 ? 4 : 2);
  }
  return (sum * h) / 3;
}

describe('beacon redshift', () => {
  it('reduces to the static gravitational factor at the release radius', () => {
    for (const r0 of [3, 7, 20]) {
      const gap = r0 - RS;
      // Still at rest, so the recession Doppler factor is exactly 1. Exactly:
      // a probe that has not been released cannot already be moving.
      expect(localInfallSpeed(gap, r0, RS)).toBe(0);
      expect(recessionDoppler(0)).toBe(1);
      expect(observedRedshift(gap, r0, RS)).toBeCloseTo(Math.sqrt(1 - RS / r0), 12);
      expect(gravitationalRedshift(gap, RS)).toBeCloseTo(Math.sqrt(1 - RS / r0), 12);
    }
  });

  it('equals gravitational shift times recession Doppler, decade by decade', () => {
    for (const r0 of [4, 7, 30]) {
      for (let exponent = 1; exponent >= -9; exponent--) {
        const gap = Math.min(Math.pow(10, exponent), r0 - RS);
        expect(observedRedshift(gap, r0, RS)).toBeCloseTo(factorisedRedshift(gap, r0, RS), 12);
      }
    }
  });

  it('reddens monotonically and stays positive and finite at absurd depth', () => {
    const r0 = 7;
    let previous = observedRedshift(r0 - RS, r0, RS);
    for (let exponent = 0; exponent >= -20; exponent--) {
      const g = observedRedshift(Math.pow(10, exponent), r0, RS);
      expect(g).toBeLessThan(previous);
      expect(g).toBeGreaterThan(0);
      previous = g;
    }
    const deepest = observedRedshift(1e-30, r0, RS);
    expect(Number.isFinite(deepest)).toBe(true);
    expect(deepest).toBeGreaterThan(0);
  });

  it('becomes linear in the gap near the horizon', () => {
    const r0 = 7;
    const energy = infallEnergy(r0, RS);
    expect(observedRedshift(1e-6, r0, RS) / observedRedshift(1e-7, r0, RS)).toBeCloseTo(10, 1);
    for (const gap of [1e-6, 1e-8]) {
      const limit = gap / (2 * energy * RS);
      expect(Math.abs(observedRedshift(gap, r0, RS) / limit - 1)).toBeLessThan(0.01);
    }
  });
});

describe('beacon coordinate motion', () => {
  it('stalls first-order in the gap, which is what makes the freeze exponential', () => {
    const r0 = 7;
    const ratio = coordinateInfallRate(1e-6, r0, RS) / coordinateInfallRate(1e-7, r0, RS);
    expect(ratio).toBeCloseTo(10, 1);
    expect(Math.abs(coordinateInfallRate(0, r0, RS))).toBe(0);
    expect(coordinateInfallRate(1e-3, r0, RS)).toBeLessThan(0);
  });

  it('leaves the release radius even though the rate there is exactly zero', () => {
    const r0 = 6;
    const gap0 = r0 - RS;
    expect(Math.abs(coordinateInfallRate(gap0, r0, RS))).toBe(0);
    expect(localSpeedGrowth(gap0, r0, RS)).toBeGreaterThan(0);
    expect(advanceHorizonGap(gap0, 0.05, r0, RS)).toBeLessThan(gap0);
  });

  it('the local speed grows everywhere on the way in and dies at the horizon', () => {
    const r0 = 6;
    expect(localSpeedGrowth(1e-9, r0, RS)).toBeGreaterThan(0);
    expect(localSpeedGrowth(1e-9, r0, RS)).toBeLessThan(localSpeedGrowth(1, r0, RS));
    expect(localSpeedGrowth(0, r0, RS)).toBe(0);
    expect(localInfallSpeed(1e-12, r0, RS)).toBeGreaterThan(0.999);
    expect(localInfallSpeed(1e-12, r0, RS)).toBeLessThanOrEqual(1);
  });

  it('never crosses the horizon, at a sane step or a pathological one', () => {
    const r0 = 6;
    for (const dt of [0.05, 5]) {
      let gap = r0 - RS;
      for (let step = 0; step < 4000; step++) {
        const next = advanceHorizonGap(gap, dt, r0, RS);
        expect(Number.isFinite(next)).toBe(true);
        expect(next).toBeGreaterThan(0);
        expect(next).toBeLessThan(gap);
        gap = next;
      }
    }
  });

  it('reproduces the analytic exp(-t / r_s) tail', () => {
    const r0 = 6;
    const dt = 0.05;
    const start = 1e-3;
    let gap = start;
    for (let step = 0; step < 5 / dt; step++) gap = advanceHorizonGap(gap, dt, r0, RS);
    expect(Math.abs(gap / start / Math.exp(-5) - 1)).toBeLessThan(0.02);
  });
});

describe("the probe's own clock", () => {
  it('matches a direct numerical integral of dtau', () => {
    for (const [r, r0] of [
      [5, 9],
      [1.5, 7],
      [1.0001, 12],
    ]) {
      expect(properTimeSinceRelease(r!, r0!, RS)).toBeCloseTo(
        integratedProperTime(r!, r0!, RS),
        6,
      );
    }
  });

  it('reaches the horizon in finite time while our clock diverges', () => {
    const r0 = 6;
    const crossing = properTimeAtHorizon(r0, RS);
    expect(Number.isFinite(crossing)).toBe(true);
    expect(crossing).toBeGreaterThan(0);

    // Walk the coordinate-time trajectory: our clock runs on and on, the
    // probe's clock climbs toward the crossing and never passes it. It does
    // reach it to float64 precision, because dtau/dr is finite at the horizon
    // while dt/dr is not, and that contrast is the whole point.
    let gap = r0 - RS;
    let previousProper = 0;
    let coordinateTime = 0;
    let strictlyRisingFor = 0;
    for (let step = 0; step < 4000; step++) {
      gap = advanceHorizonGap(gap, 0.05, r0, RS);
      coordinateTime += 0.05;
      const proper = properTimeSinceRelease(RS + gap, r0, RS);
      expect(proper).toBeGreaterThanOrEqual(previousProper);
      expect(proper).toBeLessThanOrEqual(crossing);
      if (proper > previousProper) strictlyRisingFor = step;
      previousProper = proper;
    }
    expect(strictlyRisingFor).toBeGreaterThan(100);
    expect(coordinateTime).toBeGreaterThan(crossing * 5);
    expect(previousProper / crossing).toBeGreaterThan(0.999);
  });
});

describe('where the probe is released and where it is seen', () => {
  it('keeps the click azimuth and radius, lifted out of the plane', () => {
    const clicked = new Vector3(6, 0, 8); // radius 10
    const release = releasePoint(clicked);
    expect(Math.atan2(release.z, release.x)).toBeCloseTo(Math.atan2(8, 6), 12);
    expect(release.length()).toBeCloseTo(10, 12);
    expect(release.y).toBeCloseTo(10 * Math.sin(BEACON_TUNING.inclination), 12);
  });

  it('lifts a click inside the floor out to it, and clamps a distant one', () => {
    expect(releasePoint(new Vector3(1, 0, 0)).length()).toBeCloseTo(BEACON_TUNING.rMin, 12);
    expect(releasePoint(new Vector3(500, 0, 0)).length()).toBeCloseTo(PLACEMENT_TUNING.rMax, 12);
  });

  it('never places the image inside the shadow', () => {
    // The operational constraint the whole overlay rendering rests on: the
    // sprite is drawn at this radius, so if it could fall below b_crit the
    // horizon mask would swallow the probe exactly when the freeze begins.
    for (const gap of [5, 1, 0.5, 1e-3, 1e-12, 0]) {
      expect(apparentImageRadius(RS + gap, RS)).toBeGreaterThanOrEqual(B_CRIT * RS);
    }
  });

  it('is continuous at the photon sphere and grows outward from there', () => {
    expect(apparentImageRadius(R_PHOTON * RS, RS)).toBeCloseTo(B_CRIT * RS, 12);
    expect(apparentImageRadius(1.51, RS)).toBeGreaterThan(B_CRIT * RS);
    expect(apparentImageRadius(20, RS)).toBeGreaterThan(20);
    expect(apparentImageRadius(20, RS)).toBeLessThan(22);
  });
});

describe('beacon in the world', () => {
  it('reports unsettled at release and settled once the gap closes', () => {
    const world = createWorld(16);
    placeBeacon(world, releasePoint(new Vector3(7, 0, 0)));
    expect(observeBeacon(world.beacon!).settled).toBe(false);

    const clocks = { gw: 40, tde: 1, beacon: 8 };
    for (let tick = 0; tick < 60 * 240; tick++) stepWorld(world, 1 / 60, clocks);

    const view = observeBeacon(world.beacon!);
    expect(view.horizonGap).toBeLessThan(BEACON_TUNING.settledGap);
    expect(view.settled).toBe(true);
    expect(view.redshift).toBeLessThan(1e-3);
    // Still there, still outside, still falling. It never finishes.
    expect(world.beacon).not.toBeNull();
    expect(view.horizonGap).toBeGreaterThan(0);
    expect(view.probeProperTime).toBeLessThanOrEqual(view.probeProperTimeAtHorizon);
    // Our clock has run far past the time its own clock says the crossing took.
    expect(view.coordinateTime).toBeGreaterThan(view.probeProperTimeAtHorizon * 3);
  });

  it('is dropped when a merger moves the horizon out from under it', () => {
    const world = createWorld(16);
    placeBeacon(world, releasePoint(new Vector3(7, 0, 0)));
    placeBinary(world, new Vector3(9, 0, 0));

    const clocks = { gw: 400, tde: 1, beacon: 3 };
    let lost = false;
    for (let tick = 0; tick < 60 * 200 && !lost; tick++) {
      lost = stepWorld(world, 1 / 60, clocks).beaconLost;
    }
    expect(lost).toBe(true);
    expect(world.beacon).toBeNull();
  });

  it('refuses a release radius inside the horizon', () => {
    const world = createWorld(16);
    expect(() => placeBeacon(world, new Vector3(0.5, 0, 0))).toThrow();
  });
});
