/**
 * Photon aiming: while light paths are enabled (and not placing a body), a
 * click launches a fan of rays from the camera through the clicked pixel.
 * Reports a one-line summary for the HUD.
 */
import * as THREE from 'three';
import type { GeodesicResult } from '../physics/geodesic';
import type { PhotonPathManager } from '../render/photonPaths';
import type { Settings } from '../settings';

/**
 * Around a spinning hole the two edges of the shadow sit at different impact
 * parameters, so an unsigned b no longer tells you which one a ray is near.
 * The sense is reported alongside it.
 */
function summarize(results: GeodesicResult[], spin: number): string {
  const captured = results.filter((r) => r.fate === 'captured').length;
  const bs = results.map((r) => r.b);
  const bMin = Math.min(...bs).toFixed(2);
  const bMax = Math.max(...bs).toFixed(2);
  let range = results.length === 1 ? `b=${bMin}` : `b∈[${bMin}, ${bMax}]`;
  if (spin > 0 && results.length === 1) {
    const ray = results[0]!;
    const sense = ray.axialAngularMomentum >= 0 ? 'prograde' : 'retrograde';
    range = `b=${ray.axialAngularMomentum >= 0 ? '+' : '-'}${bMin} (${sense})`;
  }
  return `${results.length} ray${results.length > 1 ? 's' : ''}: ${captured} captured · ${
    results.length - captured
  } escaped · ${range}`;
}

const DRAG_TOLERANCE_PX = 5;

export class AimingController {
  private readonly raycaster = new THREE.Raycaster();
  private downAt = { x: 0, y: 0 };

  constructor(
    private readonly domElement: HTMLElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly paths: PhotonPathManager,
    private readonly settings: Settings,
    private readonly isPlacing: () => boolean,
    private readonly onInfo: (text: string) => void,
  ) {
    domElement.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    domElement.addEventListener('click', this.onClick);
  }

  /** Launch a fan aimed straight at the hole (used when paths are toggled on). */
  launchTowardHole(): void {
    const origin = this.camera.position.clone();
    const baseDir = origin.clone().multiplyScalar(-1).normalize();
    this.launchAlong(origin, baseDir);
  }

  private launchAlong(origin: THREE.Vector3, baseDir: THREE.Vector3): void {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const results = this.paths.launchFan(
      origin,
      baseDir,
      up,
      Math.round(this.settings.photonCount),
      this.settings.photonSpreadDeg,
    );
    this.onInfo(summarize(results, this.settings.spin));
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.settings.photonsEnabled || this.isPlacing()) return;
    const moved = Math.hypot(event.clientX - this.downAt.x, event.clientY - this.downAt.y);
    if (moved > DRAG_TOLERANCE_PX) return; // was an orbit drag, not an aim

    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.launchAlong(this.camera.position.clone(), this.raycaster.ray.direction.clone());
  };
}
