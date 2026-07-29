import { describe, expect, it } from 'vitest';
import { B_CRIT } from '../constants';
import { approxDeflection, integrateNullGeodesic } from '../geodesic';

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
});
