import { describe, expect, it } from 'vitest';
import { IMAGE_ORDER_MAX, imageOrder, sweptAngle } from '../imageOrder';

const X_AXIS = { x: 1, y: 0, z: 0 };

describe('sweptAngle', () => {
  it('stays within the small-angle budget the march clamp guarantees', () => {
    // The step clamp bounds the per-step angle near 0.11 rad; 0.13 leaves
    // headroom, and the error there is still under a third of a milliradian.
    for (let i = 0; i <= 130; i++) {
      const theta = i / 1000;
      const to = { x: Math.cos(theta), y: Math.sin(theta), z: 0 };
      expect(Math.abs(sweptAngle(X_AXIS, to) - theta)).toBeLessThan(3.7e-4);
    }
    expect(Math.abs(sweptAngle(X_AXIS, { x: Math.cos(0.11), y: Math.sin(0.11), z: 0 }) - 0.11))
      .toBeLessThan(2.3e-4);
  });

  it('ignores the length of either argument', () => {
    const from = { x: 3, y: -1, z: 2 };
    const to = { x: 1, y: 4, z: -2 };
    const base = sweptAngle(from, to);
    expect(base).toBeGreaterThan(0);
    for (const scale of [0.01, 7, 1000]) {
      expect(sweptAngle({ x: from.x * scale, y: from.y * scale, z: from.z * scale }, to)).toBeCloseTo(base, 12);
      expect(sweptAngle(from, { x: to.x * scale, y: to.y * scale, z: to.z * scale })).toBeCloseTo(base, 12);
    }
  });

  it('is zero for parallel vectors and symmetric in its arguments', () => {
    expect(sweptAngle(X_AXIS, { x: 5, y: 0, z: 0 })).toBe(0);
    const from = { x: 2, y: 1, z: -3 };
    const to = { x: -1, y: 5, z: 0.5 };
    expect(sweptAngle(from, to)).toBeCloseTo(sweptAngle(to, from), 15);
  });

  it('returns zero rather than a division by zero at the center', () => {
    expect(sweptAngle({ x: 0, y: 0, z: 0 }, X_AXIS)).toBe(0);
  });
});

describe('imageOrder', () => {
  it('partitions the winding angle at multiples of pi', () => {
    expect(imageOrder(0)).toBe(0);
    expect(imageOrder(Math.PI * 0.999)).toBe(0);
    expect(imageOrder(Math.PI)).toBe(1); // a boundary belongs to the higher order
    expect(imageOrder(Math.PI * 1.999)).toBe(1);
    expect(imageOrder(2 * Math.PI)).toBe(2);
    expect(imageOrder(2.5 * Math.PI)).toBe(2);
  });

  it('saturates at the highest order the shader has a colour for', () => {
    expect(imageOrder(10 * Math.PI)).toBe(IMAGE_ORDER_MAX);
  });
});
