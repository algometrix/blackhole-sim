/**
 * Cinematic camera tours: scripted flights that take over the camera from
 * the orbit controls. Three moves:
 *
 * - 'circle': settle onto a low prograde orbit and circle until cancelled.
 * - 'flyby':  a straight ~22 s pass from deep space, skimming past the hole.
 * - 'flyin':  spiral plunge toward the horizon; the frame fades to black just
 *             outside the photon sphere, then the camera reappears at a safe
 *             overlook and fades back in.
 *
 * All distances scale with the Schwarzschild radius handed to start(), so the
 * moves keep their framing when the hole grows. The tour only writes
 * camera.position and aims it at the origin; the caller disables orbit
 * controls while update() returns true and re-enables them when it stops.
 */
import * as THREE from 'three';

export type TourKind = 'flyin' | 'flyby' | 'circle';

/** Circle orbit: radius/height in r_s, settle blend seconds, rad/s. */
const CIRCLE = {
  radius: 5.5,
  height: 1.5,
  settleTime: 2.0,
  angularSpeed: 0.3,
};

/** Flyby pass: endpoint range / lateral offset / height in r_s. */
const FLYBY = {
  duration: 22,
  range: 35,
  offset: 5,
  height: 3,
  blendTime: 1.5,
  /** Fraction of the run spent smoothstep-ramping speed at each end. */
  ramp: 0.15,
};

/** Fly-in plunge: radii in r_s, times in seconds. */
const FLYIN = {
  duration: 14,
  turns: 1.5,
  endRadius: 1.12,
  fadeStartRadius: 2.4,
  fadeEndRadius: 1.25,
  recoverTime: 1.2,
  recoverHeight: 4,
  recoverDistance: 22,
};

const ORIGIN = new THREE.Vector3(0, 0, 0);

function smooth01(x: number): number {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Normalized distance travelled along the flyby at normalized time u: speed
 * smoothstep-ramps up over the first `ramp` fraction, holds, and ramps down
 * symmetrically. This is the analytic integral of that speed profile
 * (∫ smoothstep = x^3 - x^4/2 over a ramp), rescaled so progress(1) = 1.
 */
function easedRunProgress(u: number, ramp: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const rampArea = (x: number): number => ramp * x * x * x * (1 - x / 2);
  const total = 1 - ramp;
  if (u < ramp) return rampArea(u / ramp) / total;
  if (u <= 1 - ramp) return (ramp / 2 + (u - ramp)) / total;
  return (total - rampArea((1 - u) / ramp)) / total;
}

export class CameraTour {
  private kind: TourKind | null = null;
  private rs = 1;
  private elapsed = 0;
  private fadeValue = 1;

  /** Camera position at start(); the intro blend eases away from it. */
  private readonly startPos = new THREE.Vector3();
  /** Azimuth of the start position, shared by the circle and the spiral. */
  private startAzimuth = 0;

  // Fly-in spiral state, captured at start().
  private plungeRadius0 = 0;
  private plungeElevation0 = 0;
  private recovering = false;
  private recoverStartedAt = 0;

  private readonly scratchTarget = new THREE.Vector3();

  get activeKind(): TourKind | null {
    return this.kind;
  }

  /** Composite brightness multiplier, 1 normally, dips to 0 during the fly-in plunge + recovery. */
  get fade(): number {
    return this.fadeValue;
  }

  start(kind: TourKind, camera: THREE.PerspectiveCamera, rs: number): void {
    this.kind = kind;
    this.rs = rs;
    this.elapsed = 0;
    this.fadeValue = 1;
    this.recovering = false;
    this.recoverStartedAt = 0;
    this.startPos.copy(camera.position);
    this.startAzimuth = Math.atan2(camera.position.z, camera.position.x);
    // Spiral start in spherical terms, radius clamped so a start already at
    // the horizon still reads as a plunge instead of a zero-length dive.
    const startRadius = Math.max(camera.position.length(), 1e-6);
    this.plungeRadius0 = Math.max(startRadius, 2.5 * rs);
    this.plungeElevation0 = Math.asin(THREE.MathUtils.clamp(camera.position.y / startRadius, -1, 1));
  }

  cancel(): void {
    this.kind = null;
    this.fadeValue = 1;
  }

  /** Drive the camera; returns true while the tour owns the camera. */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (this.kind === null) return false;
    this.elapsed += dt;

    const stillRunning =
      this.kind === 'circle'
        ? this.updateCircle(camera)
        : this.kind === 'flyby'
          ? this.updateFlyby(camera)
          : this.updateFlyin(camera);
    if (!stillRunning) {
      this.cancel();
      return false;
    }

    camera.lookAt(ORIGIN);
    return true;
  }

  /** Settle onto a prograde circular orbit and circle indefinitely. */
  private updateCircle(camera: THREE.PerspectiveCamera): boolean {
    const radius = CIRCLE.radius * this.rs;
    const azimuth = this.startAzimuth + CIRCLE.angularSpeed * this.elapsed;
    // p = (r cos a, h, r sin a) with increasing a gives velocity (-z, 0, x):
    // prograde with the disc.
    this.scratchTarget.set(
      radius * Math.cos(azimuth),
      CIRCLE.height * this.rs,
      radius * Math.sin(azimuth),
    );
    const settle = smooth01(this.elapsed / CIRCLE.settleTime);
    camera.position.lerpVectors(this.startPos, this.scratchTarget, settle);
    return true;
  }

  /** Straight-line pass; ends when the run time is up. */
  private updateFlyby(camera: THREE.PerspectiveCamera): boolean {
    if (this.elapsed >= FLYBY.duration) return false;

    // The line runs along z at a fixed lateral offset and height; the half
    // length is chosen so both endpoints sit exactly `range` r_s from the hole.
    const halfLength =
      Math.sqrt(FLYBY.range ** 2 - FLYBY.offset ** 2 - FLYBY.height ** 2) * this.rs;
    const progress = easedRunProgress(this.elapsed / FLYBY.duration, FLYBY.ramp);
    this.scratchTarget.set(
      FLYBY.offset * this.rs,
      FLYBY.height * this.rs,
      halfLength * (2 * progress - 1),
    );
    // Ease from wherever the camera was onto the start of the line.
    const blend = smooth01(this.elapsed / FLYBY.blendTime);
    camera.position.lerpVectors(this.startPos, this.scratchTarget, blend);
    return true;
  }

  /** Spiral plunge, blackout, teleport to the overlook, fade back in. */
  private updateFlyin(camera: THREE.PerspectiveCamera): boolean {
    if (this.recovering) return this.updateRecover(camera);

    const t = Math.min(this.elapsed / FLYIN.duration, 1);
    // Radius decays exponentially from the start radius to just outside the
    // horizon while the azimuth winds `turns` times around the hole.
    const endRadius = FLYIN.endRadius * this.rs;
    const radius = this.plungeRadius0 * Math.pow(endRadius / this.plungeRadius0, t);
    const azimuth = this.startAzimuth + FLYIN.turns * 2 * Math.PI * t;
    // The dive flattens: elevation eases to zero so the camera meets the
    // equatorial plane as it goes in.
    const elevation = this.plungeElevation0 * (1 - smooth01(t));
    const cosElevation = Math.cos(elevation);
    camera.position.set(
      radius * cosElevation * Math.cos(azimuth),
      radius * Math.sin(elevation),
      radius * cosElevation * Math.sin(azimuth),
    );

    // Fade to black across the photon-sphere approach (on radius, not time).
    this.fadeValue = smooth01(
      (radius - FLYIN.fadeEndRadius * this.rs) /
        ((FLYIN.fadeStartRadius - FLYIN.fadeEndRadius) * this.rs),
    );
    if (this.fadeValue > 0) return true;

    // Fully dark: reappear at a safe overlook and start fading back in.
    this.recovering = true;
    this.recoverStartedAt = this.elapsed;
    camera.position.set(0, FLYIN.recoverHeight * this.rs, FLYIN.recoverDistance * this.rs);
    return true;
  }

  /** Hold the overlook while brightness comes back; ends when fully faded in. */
  private updateRecover(camera: THREE.PerspectiveCamera): boolean {
    camera.position.set(0, FLYIN.recoverHeight * this.rs, FLYIN.recoverDistance * this.rs);
    const t = (this.elapsed - this.recoverStartedAt) / FLYIN.recoverTime;
    this.fadeValue = smooth01(t);
    return t < 1;
  }
}
