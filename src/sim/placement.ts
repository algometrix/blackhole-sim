/**
 * Pure placement math: clamp a requested spawn point onto the allowed ring
 * in the disc plane, and build the initial orbital velocity — sub-circular
 * prograde for the cinematic spiral, zero-energy parabolic for a realistic
 * one-pass tidal disruption.
 */
import { Vector3 } from 'three';
import { BODY_TUNING, PLACEMENT_TUNING } from '../config';
import { vCircular } from './gravity';

/**
 * Project `requested` onto the disc plane (y = 0) and clamp its radius to
 * [rMin, rMax]. Returns a new vector.
 */
export function clampPlacement(requested: Vector3, rMin = PLACEMENT_TUNING.rMin): Vector3 {
  const flat = new Vector3(requested.x, 0, requested.z);
  const r = flat.length();
  if (r < 1e-6) return new Vector3(rMin, 0, 0);
  const clamped = Math.min(Math.max(r, rMin), PLACEMENT_TUNING.rMax);
  return flat.multiplyScalar(clamped / r);
}

/**
 * Sub-circular tangential velocity, prograde with the disc's spin
 * (orbital direction (-z, 0, x), matching the disc shader), so the body
 * spirals inward instead of parking on a circular orbit or plunging.
 */
export function initialVelocity(pos: Vector3, rs = 1): Vector3 {
  const r = pos.length();
  const speed = BODY_TUNING.launchSpeedFactor * vCircular(r, rs);
  return new Vector3(-pos.z, 0, pos.x).normalize().multiplyScalar(speed);
}

/**
 * Zero-energy (parabolic) PW orbit with pericenter rPeri: the realistic-TDE
 * launch. Full speed at r is v = sqrt(rs/(r-rs)); the angular momentum of a
 * parabolic orbit grazing rPeri sets the tangential share, the rest points
 * inward. Prograde with the disc's (-z, 0, x) orbital direction.
 */
export function parabolicVelocity(pos: Vector3, rPeri: number, rs = 1): Vector3 {
  const r = pos.length();
  if (r <= rs || rPeri <= rs) {
    throw new Error(`parabolicVelocity needs r (${r}) and rPeri (${rPeri}) above rs (${rs})`);
  }
  const v = Math.sqrt(rs / (r - rs));
  const vp = Math.sqrt(rs / (rPeri - rs));
  const angMom = rPeri * vp;
  const vt = Math.min(angMom / r, v);
  const vr = -Math.sqrt(Math.max(v * v - vt * vt, 0));
  const tHat = new Vector3(-pos.z, 0, pos.x).multiplyScalar(1 / r);
  const rHat = pos.clone().multiplyScalar(1 / r);
  return tHat.multiplyScalar(vt).addScaledVector(rHat, vr);
}
