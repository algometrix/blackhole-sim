import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { CameraTour } from '../cameraTour';
import { easedRunProgress, runSpeedFraction } from '../tourKinematics';
import { circularOrbitBeta } from '../../physics/relativity';

const RAMP = 0.15;

describe('flyby speed profile', () => {
  it('is the derivative of the distance travelled', () => {
    const h = 1e-5;
    for (let u = 0.02; u < 0.98; u += 0.01) {
      const central = (easedRunProgress(u + h, RAMP) - easedRunProgress(u - h, RAMP)) / (2 * h);
      expect(central).toBeCloseTo(runSpeedFraction(u, RAMP) / (1 - RAMP), 4);
    }
  });

  it('is zero at both ends and full through the middle', () => {
    expect(runSpeedFraction(0, RAMP)).toBe(0);
    expect(runSpeedFraction(1, RAMP)).toBe(0);
    for (let u = RAMP; u <= 1 - RAMP; u += 0.05) {
      expect(runSpeedFraction(u, RAMP)).toBeCloseTo(1, 12);
    }
  });
});

describe('camera tour velocity', () => {
  const cameraAt = (x: number, y: number, z: number): PerspectiveCamera => {
    const camera = new PerspectiveCamera(60, 1.6, 0.1, 1000);
    camera.position.set(x, y, z);
    return camera;
  };

  it('is exactly zero before, at the start of, and after a flight', () => {
    const tour = new CameraTour();
    const camera = cameraAt(0, 4, 22);
    expect(tour.beta.length()).toBe(0);

    tour.start('circle', camera, 1);
    expect(tour.beta.length()).toBe(0);
    tour.update(0, camera);
    expect(tour.beta.length()).toBe(0);

    tour.update(3, camera);
    expect(tour.beta.length()).toBeGreaterThan(0);
    tour.cancel();
    expect(tour.beta.length()).toBe(0);
  });

  it('points a settled circle flight along its orbit, at the orbital speed', () => {
    const tour = new CameraTour();
    const camera = cameraAt(0, 4, 22);
    tour.start('circle', camera, 1);
    for (let t = 0; t < 6; t += 1 / 60) tour.update(1 / 60, camera);

    const radial = tour.beta.clone().normalize().dot(camera.position.clone().normalize());
    expect(Math.abs(radial)).toBeLessThan(1e-9);
    expect(tour.beta.length()).toBeCloseTo(circularOrbitBeta(camera.position.length(), 1), 9);
  });

  it('ramps a flyby in from rest and holds it below light speed', () => {
    const tour = new CameraTour();
    const camera = cameraAt(0, 4, 22);
    tour.start('flyby', camera, 1);
    tour.update(0, camera);
    expect(tour.beta.length()).toBe(0);
    for (let t = 0; t < 11; t += 1 / 60) {
      tour.update(1 / 60, camera);
      expect(tour.beta.length()).toBeLessThan(1);
    }
    expect(tour.beta.length()).toBeGreaterThan(0.2);
  });

  it('ramps a plunge in from rest along the spiral it is flying', () => {
    const tour = new CameraTour();
    const camera = cameraAt(0, 4, 22);
    tour.start('flyin', camera, 1);
    tour.update(0, camera);
    expect(tour.beta.length()).toBe(0);

    let previousRadius = camera.position.length();
    for (let t = 0; t < 5; t += 1 / 60) {
      tour.update(1 / 60, camera);
      const radius = camera.position.length();
      // Diving, so the velocity has to have an inward component.
      expect(tour.beta.dot(camera.position)).toBeLessThan(0);
      expect(radius).toBeLessThan(previousRadius);
      previousRadius = radius;
    }
    expect(tour.beta.length()).toBeGreaterThan(0.1);
    expect(tour.beta.length()).toBeLessThan(1);
  });
});
