import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { pwAccel, stepOrbit, vCircular } from '../gravity';

const DT = 1 / 60;

describe('Paczynski–Wiita gravity', () => {
  it('vCircular matches the closed form sqrt(rs r / 2)/(r - rs)', () => {
    for (const r of [4, 9, 15]) {
      expect(vCircular(r)).toBeCloseTo(Math.sqrt(0.5 * r) / (r - 1), 12);
    }
    expect(vCircular(9, 2)).toBeCloseTo(Math.sqrt(0.5 * 2 * 9) / (9 - 2), 12);
  });

  it('pwAccel scales with rs: bigger hole pulls harder', () => {
    const pos = new Vector3(9, 0, 0);
    const a1 = pwAccel(pos, new Vector3(), 1).length();
    const a2 = pwAccel(pos, new Vector3(), 2).length();
    expect(a2).toBeGreaterThan(a1);
    expect(a1).toBeCloseTo(0.5 / (8 * 8 * 9) * 9, 12);
  });

  it('a circular orbit at r=9 stays bounded over 10^4 steps (symplectic)', () => {
    const pos = new Vector3(9, 0, 0);
    const vel = new Vector3(0, 0, vCircular(9));
    const scratch = new Vector3();
    let rMin = 9;
    let rMax = 9;
    for (let i = 0; i < 10_000; i++) {
      stepOrbit(pos, vel, DT, 0, scratch);
      const r = pos.length();
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    expect(rMin).toBeGreaterThan(9 * 0.99);
    expect(rMax).toBeLessThan(9 * 1.01);
  });

  it('an orbit just inside the PW ISCO plunges', () => {
    const pos = new Vector3(2.5, 0, 0);
    const vel = new Vector3(0, 0, 0.99 * vCircular(2.5));
    const scratch = new Vector3();
    let plunged = false;
    for (let i = 0; i < 20_000 && !plunged; i++) {
      stepOrbit(pos, vel, DT, 0, scratch);
      plunged = pos.length() < 1.2;
    }
    expect(plunged).toBe(true);
  });
});
