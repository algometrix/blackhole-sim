/**
 * The property that matters for the frozen image: wherever the probe is, its
 * picture lands outside the shadow.
 *
 * The apparent radius is an impact parameter, a distance in the sky plane, so
 * the only honest test is the one that measures the sky plane offset in a real
 * viewing geometry rather than comparing the scalar against b_crit.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { B_CRIT, R_S } from '../../physics/constants';
import { apparentImageRadius, imagePosition } from '../beacon';

/** Distance of a point from the line of sight, which is what the eye sees. */
function skyPlaneOffset(point: Vector3, toCamera: Vector3): number {
  return point.clone().addScaledVector(toCamera, -point.dot(toCamera)).length();
}

const DIRECTIONS: ReadonlyArray<[string, Vector3]> = [
  ['side on', new Vector3(1, 0, 0)],
  ['directly behind the hole', new Vector3(0, 0, -1)],
  ['directly in front of the hole', new Vector3(0, 0, 1)],
  ['almost behind', new Vector3(0.02, 0.01, -1).normalize()],
  ['above', new Vector3(0, 1, 0)],
  ['oblique', new Vector3(0.4, 0.5, -0.77).normalize()],
];

describe('where the frozen image is drawn', () => {
  const toCamera = new Vector3(0, 0, 1);
  const out = new Vector3();

  it('always lands outside the shadow, from every direction', () => {
    // A probe one part in ten thousand above the horizon: the hardest case,
    // because its apparent radius has bottomed out at the photon ring.
    const radius = apparentImageRadius(R_S * 1.0001, R_S);
    for (const [name, direction] of DIRECTIONS) {
      imagePosition(direction, toCamera, radius, out);
      expect(`${name}: ${skyPlaneOffset(out, toCamera).toFixed(3)}`).toBe(
        `${name}: ${(B_CRIT * R_S).toFixed(3)}`,
      );
    }
  });

  it('puts the image exactly at the impact parameter, whatever the geometry', () => {
    for (const [, direction] of DIRECTIONS) {
      for (const r of [1.2, 2, 5, 20]) {
        const radius = apparentImageRadius(r * R_S, R_S);
        imagePosition(direction, toCamera, radius, out);
        expect(skyPlaneOffset(out, toCamera)).toBeCloseTo(radius, 6);
      }
    }
  });

  it('keeps the image on the probe’s own side of the sky', () => {
    // A probe to the right must not have its image drawn to the left.
    imagePosition(new Vector3(1, 0, -0.3).normalize(), toCamera, 4, out);
    expect(out.x).toBeGreaterThan(0);
    imagePosition(new Vector3(-1, 0, -0.3).normalize(), toCamera, 4, out);
    expect(out.x).toBeLessThan(0);
  });

  it('is lifted toward the camera so the horizon mask cannot eat it', () => {
    imagePosition(new Vector3(0, 0, -1), toCamera, 4, out);
    expect(out.dot(toCamera)).toBeGreaterThan(0);
  });

  it('never returns a non-finite position, even dead in line', () => {
    for (const direction of [new Vector3(0, 0, 1), new Vector3(0, 0, -1)]) {
      imagePosition(direction, toCamera, 4, out);
      expect(Number.isFinite(out.length())).toBe(true);
    }
  });
});
