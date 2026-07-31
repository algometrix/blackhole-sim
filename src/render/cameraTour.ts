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
 *
 * The tour also publishes `beta`, the camera velocity the relativistic optics
 * in the raymarcher are computed from, and that number is NOT the derivative
 * of the camera path. It cannot be: the flights are played back on a
 * compressed clock, moving roughly 3 r_s per wall-clock second, which is
 * several times light speed in units where c = 1, and the fly-in's recovery
 * teleport would spike it to infinity. What is published instead is the
 * physical speed of the trajectory each move stands for: a circular orbit for
 * 'circle', free fall from rest at infinity for 'flyby' and 'flyin', directed
 * along that move's own analytic tangent. Both speeds are derived and
 * documented (docs/THEORY.md parts 3 and 9), which an art-directed "tour
 * clock" divisor would not be.
 */
import * as THREE from 'three';
import { circularOrbitBeta, freeFallBeta } from '../physics/relativity';
import { easedRunProgress, runSpeedFraction } from './tourKinematics';

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
  /** Seconds over which the optics boost eases in from a standing start. */
  boostRampTime: 1.0,
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
  private readonly scratchTangent = new THREE.Vector3();
  private readonly scratchBasis = new THREE.Vector3();

  /**
   * Camera velocity in units of c, world frame, for the relativistic optics.
   * Exactly the zero vector unless a flight is running, and every move ramps
   * it in from exactly zero, so "at rest" is a fact of construction rather
   * than a threshold.
   */
  readonly beta = new THREE.Vector3();

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
    this.beta.set(0, 0, 0);
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
    // The camera stops dead at this instant, so the star field snapping back
    // is consistent with what the camera is doing. It is a choice.
    this.beta.set(0, 0, 0);
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
    // Tangent of the target path, at the circular-orbit speed for wherever the
    // camera has actually settled to. The settle blend doubles as the ramp in.
    this.beta
      .set(-Math.sin(azimuth), 0, Math.cos(azimuth))
      .multiplyScalar(circularOrbitBeta(camera.position.length(), this.rs) * settle);
    return true;
  }

  /** Straight-line pass; ends when the run time is up. */
  private updateFlyby(camera: THREE.PerspectiveCamera): boolean {
    if (this.elapsed >= FLYBY.duration) return false;

    // The line runs along z at a fixed lateral offset and height; the half
    // length is chosen so both endpoints sit exactly `range` r_s from the hole.
    const halfLength =
      Math.sqrt(FLYBY.range ** 2 - FLYBY.offset ** 2 - FLYBY.height ** 2) * this.rs;
    const u = this.elapsed / FLYBY.duration;
    const progress = easedRunProgress(u, FLYBY.ramp);
    this.scratchTarget.set(
      FLYBY.offset * this.rs,
      FLYBY.height * this.rs,
      halfLength * (2 * progress - 1),
    );
    // Ease from wherever the camera was onto the start of the line.
    const blend = smooth01(this.elapsed / FLYBY.blendTime);
    camera.position.lerpVectors(this.startPos, this.scratchTarget, blend);
    // The line runs along +z; the run's own speed profile is the ramp, so the
    // boost is strongest exactly where the pass is fastest and zero at rest.
    this.beta
      .set(0, 0, 1)
      .multiplyScalar(
        freeFallBeta(camera.position.length(), this.rs) * runSpeedFraction(u, FLYBY.ramp),
      );
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

    // Tangent of the spiral, from the analytic derivatives of the three
    // spherical coordinates above with respect to t, then given the free-fall
    // speed at the current radius.
    const dRadius = radius * Math.log(FLYIN.endRadius * this.rs / this.plungeRadius0);
    const dAzimuth = FLYIN.turns * 2 * Math.PI;
    const dElevation = -this.plungeElevation0 * 6 * t * (1 - t);
    const sinElevation = Math.sin(elevation);
    const cosAzimuth = Math.cos(azimuth);
    const sinAzimuth = Math.sin(azimuth);
    this.scratchTangent
      .set(cosElevation * cosAzimuth, sinElevation, cosElevation * sinAzimuth)
      .multiplyScalar(dRadius)
      .addScaledVector(
        this.scratchBasis.set(-sinAzimuth, 0, cosAzimuth),
        radius * cosElevation * dAzimuth,
      )
      .addScaledVector(
        this.scratchBasis.set(-sinElevation * cosAzimuth, cosElevation, -sinElevation * sinAzimuth),
        radius * dElevation,
      )
      .normalize();
    this.beta
      .copy(this.scratchTangent)
      .multiplyScalar(
        freeFallBeta(radius, this.rs) * smooth01(this.elapsed / FLYIN.boostRampTime),
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
    this.beta.set(0, 0, 0);
    return true;
  }

  /** Hold the overlook while brightness comes back; ends when fully faded in. */
  private updateRecover(camera: THREE.PerspectiveCamera): boolean {
    camera.position.set(0, FLYIN.recoverHeight * this.rs, FLYIN.recoverDistance * this.rs);
    // Parked at the overlook: nothing is moving, so nothing is boosted.
    this.beta.set(0, 0, 0);
    const t = (this.elapsed - this.recoverStartedAt) / FLYIN.recoverTime;
    this.fadeValue = smooth01(t);
    return t < 1;
  }
}
