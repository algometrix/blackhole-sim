import { describe, expect, it } from 'vitest';
import { A_STAR_MAX, B_CRIT, DT_MAX, DT_MIN, M, R_CAPTURE, SPIN_AXIS, STEP_K } from '../constants';
import {
  approxDeflection,
  integrateNullGeodesic,
  kerrDerivatives,
  kerrHamiltonian,
  kerrNullMomentum,
  type Vec3,
} from '../geodesic';
import { imageOrder } from '../imageOrder';
import {
  circularPhotonOrbitRadius,
  criticalImpactParameter,
  horizonRadius,
  kerrSchildRadius,
  spinFrame,
} from '../kerr';
import { mulberry32 } from '../../sim/__tests__/rng';

describe('null geodesic integrator', () => {
  it('captures rays with b < b_crit and passes rays with b > b_crit', () => {
    const captured = integrateNullGeodesic({ x: -30, y: 2.4, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(captured.b).toBeCloseTo(2.4, 6);
    expect(captured.fate).toBe('captured');

    const escaped = integrateNullGeodesic({ x: -30, y: 2.8, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(escaped.b).toBeCloseTo(2.8, 6);
    expect(escaped.fate).toBe('escaped');
    expect(escaped.b).toBeGreaterThan(B_CRIT);
  });

  it('matches the weak-field deflection 2/b for a wide pass', () => {
    const b = 20;
    const res = integrateNullGeodesic(
      { x: -200, y: b, z: 0 },
      { x: 1, y: 0, z: 0 },
      { maxSteps: 8000, escapeR: 200 },
    );
    expect(res.fate).toBe('escaped');

    const n = res.points.length;
    const vx = res.points[n - 3]! - res.points[n - 6]!;
    const vy = res.points[n - 2]! - res.points[n - 5]!;
    const bend = Math.abs(Math.atan2(vy, vx));
    expect(bend).toBeGreaterThan(approxDeflection(b) * 0.9);
    expect(bend).toBeLessThan(approxDeflection(b) * 1.1);
  });

  it('winds further around the hole the closer the ray passes', () => {
    const windingFor = (b: number): number =>
      integrateNullGeodesic({ x: -30, y: b, z: 0 }, { x: 1, y: 0, z: 0 }, { maxSteps: 8000 })
        .windingAngle;

    const wide = windingFor(20);
    const near = windingFor(2.62); // just outside b_crit = 2.598
    expect(wide).toBeLessThan(Math.PI);
    expect(imageOrder(wide)).toBe(0);
    expect(near).toBeGreaterThan(2 * Math.PI);
    expect(imageOrder(near)).toBe(2);
    expect(windingFor(2.62)).toBeGreaterThan(windingFor(3));
    expect(windingFor(3)).toBeGreaterThan(windingFor(10));
    expect(windingFor(10)).toBeGreaterThan(windingFor(20));
  });

  it('never unwinds: a shorter integration reports no more winding', () => {
    const full = integrateNullGeodesic(
      { x: -30, y: 2.62, z: 0 },
      { x: 1, y: 0, z: 0 },
      { maxSteps: 8000 },
    );
    const truncated = integrateNullGeodesic(
      { x: -30, y: 2.62, z: 0 },
      { x: 1, y: 0, z: 0 },
      { maxSteps: 200 },
    );
    expect(truncated.windingAngle).toBeLessThanOrEqual(full.windingAngle);
    expect(truncated.windingAngle).toBeGreaterThan(0);
  });
});

// --- Kerr ---------------------------------------------------------------

const SPIN_TEST_MASS = M; // r_s = 1 throughout these tests

/** Signed axial angular momentum of a state about SPIN_AXIS. */
function axialL(x: Vec3, p: Vec3): number {
  return (
    (x.y * p.z - x.z * p.y) * SPIN_AXIS.x +
    (x.z * p.x - x.x * p.z) * SPIN_AXIS.y +
    (x.x * p.y - x.y * p.x) * SPIN_AXIS.z
  );
}

/** One RK4 step over the exported equations of motion. */
function kerrStep(x: Vec3, p: Vec3, dt: number, a: number): { x: Vec3; p: Vec3 } {
  const add = (u: Vec3, v: Vec3, s: number): Vec3 => ({
    x: u.x + s * v.x,
    y: u.y + s * v.y,
    z: u.z + s * v.z,
  });
  const d1 = kerrDerivatives(x, p, a, SPIN_TEST_MASS);
  const d2 = kerrDerivatives(add(x, d1.dx, dt / 2), add(p, d1.dp, dt / 2), a, SPIN_TEST_MASS);
  const d3 = kerrDerivatives(add(x, d2.dx, dt / 2), add(p, d2.dp, dt / 2), a, SPIN_TEST_MASS);
  const d4 = kerrDerivatives(add(x, d3.dx, dt), add(p, d3.dp, dt), a, SPIN_TEST_MASS);
  const combine = (u: Vec3, k1: Vec3, k2: Vec3, k3: Vec3, k4: Vec3): Vec3 => ({
    x: u.x + (dt / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: u.y + (dt / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
    z: u.z + (dt / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
  });
  return {
    x: combine(x, d1.dx, d2.dx, d3.dx, d4.dx),
    p: combine(p, d1.dp, d2.dp, d3.dp, d4.dp),
  };
}

describe('Kerr null launch', () => {
  const rng = mulberry32(97);

  it('produces an exactly null momentum for any camera, direction and spin', () => {
    for (let i = 0; i < 200; i++) {
      const spin = rng() * A_STAR_MAX;
      const a = spin * M;
      const radius = 2 * horizonRadius(spin) + rng() * 30;
      const theta = Math.acos(2 * rng() - 1);
      const phi = rng() * 2 * Math.PI;
      const x: Vec3 = {
        x: radius * Math.sin(theta) * Math.cos(phi),
        y: radius * Math.cos(theta),
        z: radius * Math.sin(theta) * Math.sin(phi),
      };
      const raw = { x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 };
      const len = Math.hypot(raw.x, raw.y, raw.z);
      const dir: Vec3 = { x: raw.x / len, y: raw.y / len, z: raw.z / len };
      const p = kerrNullMomentum(x, dir, a, SPIN_TEST_MASS);
      expect(Math.abs(kerrHamiltonian(x, p, a, SPIN_TEST_MASS))).toBeLessThan(1e-12);
    }
  });

  it('leaves the direction untouched when the hole does not spin and is far away', () => {
    const dir: Vec3 = { x: 0.6, y: 0, z: 0.8 };
    const p = kerrNullMomentum({ x: -4000, y: 0, z: 0 }, dir, 0, SPIN_TEST_MASS);
    expect(p.x).toBeCloseTo(dir.x, 3);
    expect(p.y).toBeCloseTo(dir.y, 3);
    expect(p.z).toBeCloseTo(dir.z, 3);
  });
});

/**
 * Worst drift of the two constants of motion along one approach, integrated
 * with the shipped step rule scaled by `stepScale`.
 */
function conservationDrift(
  spin: number,
  offset: number,
  stepScale: number,
): { hamiltonian: number; axialMomentum: number } {
  const a = spin * M;
  const rPlus = horizonRadius(spin);
  const start: Vec3 = { x: -25, y: 0, z: offset };
  let x = start;
  let p = kerrNullMomentum(start, { x: 1, y: 0, z: 0 }, a, SPIN_TEST_MASS);
  const launchMomentum = axialL(x, p);
  let hamiltonian = 0;
  let axialMomentum = 0;
  for (let step = 0; step < 4000; step++) {
    const spun = spinFrame(x);
    const r = kerrSchildRadius(spun.x, spun.y, spun.z, a);
    if (r < 1.05 * rPlus) break;
    hamiltonian = Math.max(hamiltonian, Math.abs(kerrHamiltonian(x, p, a, SPIN_TEST_MASS)));
    axialMomentum = Math.max(axialMomentum, Math.abs(axialL(x, p) - launchMomentum));
    const dt = Math.min(Math.max(STEP_K * (r - 0.9 * rPlus), DT_MIN), DT_MAX) * stepScale;
    const next = kerrStep(x, p, dt, a);
    x = next.x;
    p = next.p;
  }
  return { hamiltonian, axialMomentum };
}

describe('Kerr equations of motion', () => {
  it('conserves both constants of motion on rays that pass the hole', () => {
    // Both quantities are of order 1 here, so this is five clean digits held
    // over the whole approach, for the rays that actually make a picture.
    for (const spin of [0.2, 0.6, 0.9, A_STAR_MAX]) {
      for (const offset of [-4, 4]) {
        const drift = conservationDrift(spin, offset, 1);
        expect(drift.hamiltonian).toBeLessThan(1e-5);
        expect(drift.axialMomentum).toBeLessThan(1e-5);
      }
    }
  });

  it('stays bounded even on rays that plunge into a near-extremal horizon', () => {
    // Worst case in the whole app: DT_MIN = 0.02 is coarse against a horizon
    // that has shrunk to 0.53, so a plunging ray takes a handful of steps
    // through the steepest part of the metric. It ends up inside the shadow
    // either way, which is why the shipped step floor is left alone.
    for (const spin of [0.9, A_STAR_MAX]) {
      for (const offset of [-1.5, 1.5]) {
        const drift = conservationDrift(spin, offset, 1);
        expect(drift.hamiltonian).toBeLessThan(5e-3);
        expect(drift.axialMomentum).toBeLessThan(5e-3);
      }
    }
  });

  it('leaves only fourth-order truncation error behind', () => {
    // Halving the step has to cut the drift by a large factor. A wrong term in
    // the derivatives would leave a floor that refuses to shrink, which is
    // what separates "the equations are right" from "the tolerance was kind".
    for (const spin of [0.6, 0.9, A_STAR_MAX]) {
      for (const offset of [-4, -1.5, 1.5, 4]) {
        const coarse = conservationDrift(spin, offset, 1);
        const fine = conservationDrift(spin, offset, 0.5);
        expect(fine.hamiltonian).toBeLessThan(coarse.hamiltonian / 8);
        expect(fine.axialMomentum).toBeLessThan(coarse.axialMomentum / 8);
      }
    }
  });
});

describe('Kerr integrator', () => {
  it('agrees with the Schwarzschild integrator as the spin goes to zero', () => {
    const finalDirection = (result: ReturnType<typeof integrateNullGeodesic>): number => {
      const n = result.points.length;
      return Math.atan2(result.points[n - 2]! - result.points[n - 5]!, result.points[n - 3]! - result.points[n - 6]!);
    };
    const opts = { maxSteps: 12000, escapeR: 200 };
    const schwarzschild = integrateNullGeodesic({ x: -200, y: 20, z: 0 }, { x: 1, y: 0, z: 0 }, opts);
    const kerr = integrateNullGeodesic(
      { x: -200, y: 20, z: 0 },
      { x: 1, y: 0, z: 0 },
      { ...opts, spin: 1e-6 },
    );
    expect(kerr.fate).toBe('escaped');
    expect(Math.abs(finalDirection(kerr) - finalDirection(schwarzschild))).toBeLessThan(1e-3);

    for (const b of [2.4, 2.8]) {
      const a = integrateNullGeodesic({ x: -30, y: b, z: 0 }, { x: 1, y: 0, z: 0 });
      const k = integrateNullGeodesic({ x: -30, y: b, z: 0 }, { x: 1, y: 0, z: 0 }, { spin: 1e-6 });
      expect(k.fate).toBe(a.fate);
    }
  });

  it('splits capture from escape at the prograde and retrograde critical impact parameters', () => {
    const spin = 0.9;
    // L_z = (x cross p) . (0, -1, 0), so from (-200, 0, offset) travelling +x
    // a negative offset is the prograde side.
    const fateAt = (offset: number) =>
      integrateNullGeodesic(
        { x: -200, y: 0, z: offset },
        { x: 1, y: 0, z: 0 },
        { maxSteps: 30000, escapeR: 200, spin },
      );

    const prograde = criticalImpactParameter(spin, 'prograde');
    const retrograde = Math.abs(criticalImpactParameter(spin, 'retrograde'));
    expect(prograde).toBeLessThan(retrograde); // the shadow is lopsided

    expect(fateAt(-0.98 * prograde).fate).toBe('captured');
    expect(fateAt(-1.02 * prograde).fate).toBe('escaped');
    expect(fateAt(0.98 * retrograde).fate).toBe('captured');
    expect(fateAt(1.02 * retrograde).fate).toBe('escaped');

    // The sign convention the caller uses to pick a sense.
    expect(fateAt(-1.02 * prograde).axialAngularMomentum).toBeGreaterThan(0);
    expect(fateAt(1.02 * retrograde).axialAngularMomentum).toBeLessThan(0);
  });

  it('turns near-critical rays around at the photon orbit of their own sense', () => {
    // The Kerr-Schild radius is the Boyer-Lindquist radius, so the turning
    // point of a ray aimed just outside b_crit has to land on the closed-form
    // photon orbit. This is the one test that ties kerr.ts and the integrator
    // together: they are derived independently and must agree.
    for (const spin of [1e-9, 0.5, 0.9]) {
      for (const sense of ['prograde', 'retrograde'] as const) {
        const b = criticalImpactParameter(spin, sense);
        const result = integrateNullGeodesic(
          { x: -200, y: 0, z: -Math.sign(b) * Math.abs(b) * 1.0005 },
          { x: 1, y: 0, z: 0 },
          { maxSteps: 60000, escapeR: 200, recordEvery: 1, spin },
        );
        expect(result.fate).toBe('escaped');

        let closest = Infinity;
        for (let i = 0; i < result.points.length; i += 3) {
          const spun = spinFrame({
            x: result.points[i]!,
            y: result.points[i + 1]!,
            z: result.points[i + 2]!,
          });
          closest = Math.min(closest, kerrSchildRadius(spun.x, spun.y, spun.z, spin * M));
        }
        const photon = circularPhotonOrbitRadius(spin, sense);
        expect(closest).toBeGreaterThanOrEqual(photon);
        expect(closest).toBeLessThan(photon * 1.04);
      }
    }
  });

  it('drags a ray with no angular momentum around the hole, and only when it spins', () => {
    // Measured in the Kerr-Schild azimuth the app actually draws in, which
    // absorbs part of the Boyer-Lindquist winding, so the interesting claim is
    // the sign and the ordering, not the size of the angle.
    const sweptAzimuth = (spin: number): number => {
      const result = integrateNullGeodesic(
        { x: -30, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { maxSteps: 4000, recordEvery: 1, spin },
      );
      expect(result.axialAngularMomentum).toBeCloseTo(0, 12);
      let total = 0;
      let previous = Number.NaN;
      for (let i = 0; i < result.points.length; i += 3) {
        const spun = spinFrame({
          x: result.points[i]!,
          y: result.points[i + 1]!,
          z: result.points[i + 2]!,
        });
        const azimuth = Math.atan2(spun.y, spun.x);
        if (Number.isFinite(previous)) {
          let step = azimuth - previous;
          if (step > Math.PI) step -= 2 * Math.PI;
          if (step < -Math.PI) step += 2 * Math.PI;
          // Dragging never runs backwards, so any negative step is an error.
          expect(step).toBeGreaterThan(-1e-12);
          total += step;
        }
        previous = azimuth;
      }
      return total;
    };

    // Zero spin takes the Schwarzschild path, where a radial ray stays radial.
    expect(sweptAzimuth(0)).toBe(0);
    let previousDrag = 0;
    for (const spin of [0.3, 0.5, 0.7, 0.9, A_STAR_MAX]) {
      const drag = sweptAzimuth(spin);
      expect(drag).toBeGreaterThan(previousDrag);
      previousDrag = drag;
    }
  });

  it('stops at the shrunken horizon rather than at 1 r_s', () => {
    for (const spin of [0.5, 0.9, A_STAR_MAX]) {
      const result = integrateNullGeodesic(
        { x: -30, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { maxSteps: 4000, spin },
      );
      expect(result.fate).toBe('captured');
      const n = result.points.length;
      const spun = spinFrame({
        x: result.points[n - 3]!,
        y: result.points[n - 2]!,
        z: result.points[n - 1]!,
      });
      const radius = kerrSchildRadius(spun.x, spun.y, spun.z, spin * M);
      const expected = R_CAPTURE * horizonRadius(spin);
      expect(radius).toBeLessThanOrEqual(expected);
      expect(radius).toBeGreaterThan(0.8 * expected);
      if (spin > 0.5) expect(radius).toBeLessThan(R_CAPTURE);
    }
  });

  it('refuses to spin a superposed pair, and spin 0 is the untouched old path', () => {
    const centers = [
      { x: 0, y: 0, z: 0, rs: 1 },
      { x: 6, y: 0, z: 0, rs: 0.3 },
    ];
    expect(() =>
      integrateNullGeodesic({ x: -30, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, { centers, spin: 0.5 }),
    ).toThrow(/superposed/);

    const withZero = integrateNullGeodesic({ x: -30, y: 2.8, z: 0 }, { x: 1, y: 0, z: 0 }, { spin: 0 });
    const without = integrateNullGeodesic({ x: -30, y: 2.8, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(Array.from(withZero.points)).toEqual(Array.from(without.points));
    expect(withZero.fate).toBe(without.fate);
  });
});
