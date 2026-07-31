/**
 * Orbit camera locked on the hole, with idle detection that drives the
 * temporal accumulation (jittered frames only converge while nothing moves).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_TUNING } from '../config';

const IDLE_AFTER_MS = 250;

/** Where the camera stands, in the orbit terms the rig actually thinks in. */
export interface CameraPose {
  distance: number;
  /** Elevation above the disc plane, radians. */
  elevation: number;
  /** Azimuth around the hole, radians. */
  azimuth: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private lastMoveAt = 0;

  constructor(aspect: number, domElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.05, 500);
    const d = CAMERA_TUNING.initialDistance;
    const el = CAMERA_TUNING.initialElevation;
    this.camera.position.set(0, d * Math.sin(el), d * Math.cos(el));

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = CAMERA_TUNING.minDistance;
    this.controls.maxDistance = CAMERA_TUNING.maxDistance;
    this.controls.addEventListener('change', () => {
      this.lastMoveAt = performance.now();
    });
    this.controls.update();
  }

  /** Call once per frame; returns true when the camera has settled. */
  update(): boolean {
    this.controls.update();
    return performance.now() - this.lastMoveAt > IDLE_AFTER_MS;
  }

  /** Jump to a pose expressed in orbit terms (used by the scene presets). */
  moveTo(pose: CameraPose): void {
    const { distance, elevation, azimuth } = pose;
    const horizontal = distance * Math.cos(elevation);
    this.camera.position.set(
      horizontal * Math.cos(azimuth),
      distance * Math.sin(elevation),
      horizontal * Math.sin(azimuth),
    );
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = true;
    this.controls.update();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
