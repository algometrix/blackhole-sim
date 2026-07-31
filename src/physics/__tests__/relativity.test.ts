import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../geodesic';
import {
  MAX_OBSERVER_BETA,
  aberrateLookDirection,
  circularOrbitBeta,
  freeFallBeta,
  lorentzGamma,
} from '../relativity';

const AT_REST: Vec3 = { x: 0, y: 0, z: 0 };

/** A spread of unit look directions, none of them axis aligned by accident. */
function lookGrid(): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 1; j < 8; j++) {
      const phi = (i / 8) * 2 * Math.PI;
      const theta = (j / 8) * Math.PI;
      out.push({
        x: Math.sin(theta) * Math.cos(phi),
        y: Math.cos(theta),
        z: Math.sin(theta) * Math.sin(phi),
      });
    }
  }
  return out;
}

const scaled = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const dot = (u: Vec3, v: Vec3): number => u.x * v.x + u.y * v.y + u.z * v.z;

describe('aberration', () => {
  it('is exactly the identity for an observer at rest', () => {
    for (const look of lookGrid()) {
      const ray = aberrateLookDirection(look, AT_REST);
      expect(ray.dir.x).toBe(look.x);
      expect(ray.dir.y).toBe(look.y);
      expect(ray.dir.z).toBe(look.z);
      expect(ray.doppler).toBe(1);
    }
  });

  it('keeps the direction a unit vector at every speed', () => {
    const axis: Vec3 = { x: 0.6, y: 0.48, z: 0.64 };
    for (const speed of [0.1, 0.5, 0.95]) {
      const beta = scaled(axis, speed);
      for (const look of lookGrid()) {
        const { dir } = aberrateLookDirection(look, beta);
        expect(Math.abs(Math.hypot(dir.x, dir.y, dir.z) - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it('undoes itself when the boost is reversed', () => {
    const beta: Vec3 = { x: 0.3, y: -0.42, z: 0.15 };
    const reverse = scaled(beta, -1);
    for (const look of lookGrid()) {
      const forward = aberrateLookDirection(look, beta);
      const back = aberrateLookDirection(forward.dir, reverse);
      expect(back.dir.x).toBeCloseTo(look.x, 12);
      expect(back.dir.y).toBeCloseTo(look.y, 12);
      expect(back.dir.z).toBeCloseTo(look.z, 12);
      expect(forward.doppler * back.doppler).toBeCloseTo(1, 12);
    }
  });

  it('drags every static direction backward, which is the headlight effect', () => {
    const forward: Vec3 = { x: 1, y: 0, z: 0 };
    const beta = scaled(forward, 0.7);
    for (const look of lookGrid()) {
      // Straight ahead and straight behind are fixed points, asserted below.
      if (Math.abs(dot(look, forward)) > 1 - 1e-9) continue;
      const { dir } = aberrateLookDirection(look, beta);
      expect(dot(dir, forward)).toBeLessThan(dot(look, forward));
    }
    // The two fixed points of the map: straight ahead and straight behind.
    for (const look of [forward, scaled(forward, -1)]) {
      const { dir } = aberrateLookDirection(look, beta);
      expect(dot(dir, forward)).toBeCloseTo(dot(look, forward), 12);
    }
  });

  it('gives the textbook Doppler factors along, against and across the motion', () => {
    const speed = 0.6;
    const gamma = lorentzGamma(speed);
    const beta: Vec3 = { x: 0, y: 0, z: speed };
    expect(aberrateLookDirection({ x: 0, y: 0, z: 1 }, beta).doppler).toBeCloseTo(
      gamma * (1 + speed),
      12,
    );
    expect(aberrateLookDirection({ x: 0, y: 0, z: -1 }, beta).doppler).toBeCloseTo(
      gamma * (1 - speed),
      12,
    );
    // Perpendicular in the camera frame: pure transverse redshift, the case
    // that separates this form from the static-frame one.
    expect(aberrateLookDirection({ x: 1, y: 0, z: 0 }, beta).doppler).toBeCloseTo(1 / gamma, 12);
  });
});

describe('trajectory speeds', () => {
  it('gives the ISCO circular speed of c/2 and falls off outward', () => {
    expect(circularOrbitBeta(3, 1)).toBeCloseTo(0.5, 12);
    let previous = 1;
    for (let r = 3; r <= 40; r += 0.25) {
      const beta = circularOrbitBeta(r, 1);
      expect(beta).toBeLessThan(previous);
      previous = beta;
    }
    for (let r = 1.0; r <= 1.3; r += 0.05) {
      expect(circularOrbitBeta(r, 1)).toBeLessThanOrEqual(MAX_OBSERVER_BETA);
    }
  });

  it('gives the free-fall speed sqrt(rs/r) outside the horizon and clamps inside', () => {
    for (let r = 1.2; r <= 40; r += 0.4) {
      expect(freeFallBeta(r, 1)).toBeCloseTo(Math.sqrt(1 / r), 12);
    }
    let previous = 1;
    for (let r = 1.2; r <= 40; r += 0.4) {
      const beta = freeFallBeta(r, 1);
      expect(beta).toBeLessThan(previous);
      previous = beta;
    }
    expect(freeFallBeta(1, 1)).toBe(MAX_OBSERVER_BETA);
    expect(freeFallBeta(0.4, 1)).toBe(MAX_OBSERVER_BETA);
    expect(lorentzGamma(freeFallBeta(0, 1))).toBeLessThan(4);
  });
});
