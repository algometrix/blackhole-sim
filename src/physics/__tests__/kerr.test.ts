import { describe, expect, it } from 'vitest';
import { A_STAR_MAX, B_CRIT, M, R_ISCO, R_PHOTON, R_S } from '../constants';
import {
  circularOrbitKinematics,
  circularPhotonOrbitRadius,
  criticalImpactParameter,
  horizonRadius,
  innerHorizonRadius,
  innermostStableCircularOrbit,
  kerrSchildRadius,
  spinFrame,
  worldFrame,
  type OrbitSense,
} from '../kerr';
import { mulberry32 } from '../../sim/__tests__/rng';

const SENSES: readonly OrbitSense[] = ['prograde', 'retrograde'];

/** 200 spins spanning the allowed range, endpoints included. */
function spinSweep(): number[] {
  return Array.from({ length: 200 }, (_, i) => (A_STAR_MAX * i) / 199);
}

describe('Kerr closed forms', () => {
  it('reduces to the Schwarzschild constants at zero spin', () => {
    expect(horizonRadius(0)).toBeCloseTo(R_S, 12);
    for (const sense of SENSES) {
      expect(circularPhotonOrbitRadius(0, sense)).toBeCloseTo(R_PHOTON, 12);
      expect(innermostStableCircularOrbit(0, sense)).toBeCloseTo(R_ISCO, 12);
      expect(Math.abs(criticalImpactParameter(0, sense))).toBeCloseTo(B_CRIT, 12);
    }
  });

  it('hits the known extremal limits at a/M = 1', () => {
    expect(horizonRadius(1)).toBeCloseTo(M, 9);
    expect(innerHorizonRadius(1)).toBeCloseTo(M, 9);
    expect(innermostStableCircularOrbit(1, 'prograde')).toBeCloseTo(M, 9);
    expect(innermostStableCircularOrbit(1, 'retrograde')).toBeCloseTo(9 * M, 9);
    expect(circularPhotonOrbitRadius(1, 'prograde')).toBeCloseTo(M, 9);
    expect(circularPhotonOrbitRadius(1, 'retrograde')).toBeCloseTo(4 * M, 9);
    expect(criticalImpactParameter(1, 'retrograde')).toBeCloseTo(-7 * M, 9);
  });

  it('keeps the radii ordered for every allowed spin', () => {
    for (const spin of spinSweep()) {
      const rMinus = innerHorizonRadius(spin);
      const rPlus = horizonRadius(spin);
      const photon = circularPhotonOrbitRadius(spin, 'prograde');
      const isco = innermostStableCircularOrbit(spin, 'prograde');
      expect(rMinus).toBeLessThanOrEqual(rPlus);
      expect(rPlus).toBeLessThanOrEqual(photon);
      expect(photon).toBeLessThanOrEqual(isco);
      expect(photon).toBeLessThanOrEqual(R_PHOTON);
      expect(circularPhotonOrbitRadius(spin, 'retrograde')).toBeGreaterThanOrEqual(R_PHOTON);
    }
  });

  it('moves every prograde quantity inward and every retrograde one outward', () => {
    const sweep = spinSweep();
    for (let i = 1; i < sweep.length; i++) {
      const lo = sweep[i - 1]!;
      const hi = sweep[i]!;
      expect(horizonRadius(hi)).toBeLessThan(horizonRadius(lo));
      expect(innermostStableCircularOrbit(hi, 'prograde')).toBeLessThan(
        innermostStableCircularOrbit(lo, 'prograde'),
      );
      expect(circularPhotonOrbitRadius(hi, 'prograde')).toBeLessThan(
        circularPhotonOrbitRadius(lo, 'prograde'),
      );
      expect(Math.abs(criticalImpactParameter(hi, 'prograde'))).toBeLessThan(
        Math.abs(criticalImpactParameter(lo, 'prograde')),
      );
      expect(innermostStableCircularOrbit(hi, 'retrograde')).toBeGreaterThan(
        innermostStableCircularOrbit(lo, 'retrograde'),
      );
      expect(circularPhotonOrbitRadius(hi, 'retrograde')).toBeGreaterThan(
        circularPhotonOrbitRadius(lo, 'retrograde'),
      );
      expect(Math.abs(criticalImpactParameter(hi, 'retrograde'))).toBeGreaterThan(
        Math.abs(criticalImpactParameter(lo, 'retrograde')),
      );
    }
  });

  it('reports the values quoted in the spin tooltip and the readout', () => {
    // These are what the panel tooltip and docs/THEORY.md tell the user, so
    // the numbers cannot go stale without a test failing.
    expect(horizonRadius(A_STAR_MAX)).toBeCloseTo(0.53161, 4);
    expect(innermostStableCircularOrbit(A_STAR_MAX, 'prograde')).toBeCloseTo(0.61849, 4);
    expect(criticalImpactParameter(A_STAR_MAX, 'prograde')).toBeCloseTo(1.05544, 4);
    expect(criticalImpactParameter(A_STAR_MAX, 'retrograde')).toBeCloseTo(-3.49833, 4);
  });
});

describe('Kerr-Schild radius', () => {
  const rng = mulberry32(11);
  const randomPoint = (scale: number): [number, number, number] => [
    (rng() * 2 - 1) * scale,
    (rng() * 2 - 1) * scale,
    (rng() * 2 - 1) * scale,
  ];

  it('is the ordinary radius when the hole does not spin', () => {
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = randomPoint(20);
      expect(kerrSchildRadius(x, y, z, 0)).toBeCloseTo(Math.hypot(x, y, z), 12);
    }
  });

  it('returns r+ exactly on the horizon spheroid', () => {
    for (const spin of [0.2, 0.6, 0.9, A_STAR_MAX]) {
      const a = spin * M;
      const rPlus = horizonRadius(spin);
      for (let i = 0; i < 20; i++) {
        const theta = rng() * Math.PI;
        const phi = rng() * 2 * Math.PI;
        const rho = Math.sqrt(rPlus * rPlus + a * a) * Math.sin(theta);
        const x = rho * Math.cos(phi);
        const y = rho * Math.sin(phi);
        const z = rPlus * Math.cos(theta);
        expect(kerrSchildRadius(x, y, z, a)).toBeCloseTo(rPlus, 10);
      }
    }
  });

  it('is invariant under rotation about the spin axis', () => {
    const a = 0.9 * M;
    for (let i = 0; i < 30; i++) {
      const [x, y, z] = randomPoint(8);
      const angle = rng() * 2 * Math.PI;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      expect(kerrSchildRadius(x * c - y * s, x * s + y * c, z, a)).toBeCloseTo(
        kerrSchildRadius(x, y, z, a),
        12,
      );
    }
  });

  it('approaches |x| from below, with the deficit falling off as a^2/|x|', () => {
    const a = 0.9 * M;
    // Off-axis so the a^2 z^2 term does not vanish.
    const deficitAt = (scale: number): number => {
      const x = scale * 0.6;
      const z = scale * 0.8;
      return Math.hypot(x, 0, z) - kerrSchildRadius(x, 0, z, a);
    };
    const near = deficitAt(20);
    const far = deficitAt(200);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
    // Ten times further out, ten times smaller.
    expect(near / far).toBeCloseTo(10, 0);
  });
});

describe('spin frame', () => {
  const rng = mulberry32(23);
  const randomVec = () => ({ x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 });
  const cross = (u: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) => ({
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  });

  it('round trips world -> spin -> world', () => {
    for (let i = 0; i < 40; i++) {
      const w = randomVec();
      const back = worldFrame(spinFrame(w));
      expect(back.x).toBeCloseTo(w.x, 15);
      expect(back.y).toBeCloseTo(w.y, 15);
      expect(back.z).toBeCloseTo(w.z, 15);
    }
  });

  it('is right handed, so cross products survive the change of frame', () => {
    for (let i = 0; i < 40; i++) {
      const u = randomVec();
      const v = randomVec();
      const mapped = spinFrame(cross(u, v));
      const crossed = cross(spinFrame(u), spinFrame(v));
      expect(mapped.x).toBeCloseTo(crossed.x, 15);
      expect(mapped.y).toBeCloseTo(crossed.y, 15);
      expect(mapped.z).toBeCloseTo(crossed.z, 15);
    }
  });

  it('maps the disc gas at world (r, 0, 0) to +Y, so positive spin is prograde', () => {
    // The disc orbits along phiHat = (-z, 0, x); at (r, 0, 0) that is +z.
    const gas = spinFrame({ x: 0, y: 0, z: 1 });
    expect(gas).toEqual({ x: 0, y: 1, z: -0 });
    const position = spinFrame({ x: 5, y: 0, z: 0 });
    expect(position).toEqual({ x: 5, y: 0, z: -0 });
  });
});

describe('circular orbit kinematics', () => {
  it('reproduces the Schwarzschild disc expressions at zero spin', () => {
    for (let r = 3; r <= 40; r += 0.25) {
      const k = circularOrbitKinematics(r, 0);
      expect(k.omega).toBeCloseTo(Math.sqrt(M / (r * r * r)), 12);
      expect(k.speedVsZamo).toBeCloseTo(Math.sqrt(M / (r - 2 * M)), 12);
      expect(k.redshift).toBeCloseTo(Math.sqrt(1 - (3 * M) / r), 12);
    }
  });

  it('stays physical from the ISCO outward at every spin', () => {
    for (const spin of [0, 0.3, 0.6, 0.9, A_STAR_MAX]) {
      const a = spin * M;
      const isco = innermostStableCircularOrbit(spin, 'prograde');
      let previousRedshift = 0;
      for (let r = isco; r <= 30; r += 0.1) {
        const k = circularOrbitKinematics(r, a);
        expect(k.speedVsZamo).toBeGreaterThan(0);
        expect(k.speedVsZamo).toBeLessThan(1);
        expect(k.redshift).toBeGreaterThan(0);
        expect(k.redshift).toBeLessThanOrEqual(1);
        // Light from further out climbs out of a shallower well.
        expect(k.redshift).toBeGreaterThan(previousRedshift);
        previousRedshift = k.redshift;
      }
    }
  });

  it('approaches the extremal ISCO speed of c/2', () => {
    // The classic extremal value, and an independent check on the Delta and
    // u^t algebra. It is a limit: at the shipped 0.998 clamp the speed is
    // still 0.565, and only near a/M = 1 does it settle on 0.5.
    const spin = 1 - 1e-8;
    const isco = innermostStableCircularOrbit(spin, 'prograde');
    expect(circularOrbitKinematics(isco, spin * M).speedVsZamo).toBeCloseTo(0.5, 2);
  });
});
