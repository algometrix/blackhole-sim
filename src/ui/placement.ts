/**
 * Click-to-place a planet, star, or secondary black hole: a translucent
 * ghost follows the cursor on the disc plane (clamped to the allowed ring),
 * click confirms, Esc or right-click cancels. Orbit controls are suspended
 * while placing. What happens on confirm is the caller's business (placeBody
 * vs placeBinary), delivered through the onPlace callback.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BINARY_TUNING, BODY_TUNING, PLACEMENT_TUNING } from '../config';
import { clampPlacement } from '../sim/placement';

/** What can be placed: the two disruptable bodies, or the secondary hole. */
export type PlaceKind = 'planet' | 'star' | 'bh2';

interface KindLook {
  color: number;
  radius: number;
  rMin: number;
}

const KIND_LOOKS: Record<PlaceKind, KindLook> = {
  planet: { color: 0xb08a63, radius: BODY_TUNING.planetRadius, rMin: PLACEMENT_TUNING.rMin },
  star: { color: 0xffd9a0, radius: BODY_TUNING.starRadius, rMin: PLACEMENT_TUNING.rMin },
  bh2: { color: 0x5577aa, radius: BINARY_TUNING.massRatio, rMin: PLACEMENT_TUNING.bh2RMin },
};

function makeRing(radius: number, opacity: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.06, radius + 0.06, 160),
    new THREE.MeshBasicMaterial({
      color: 0x77aacc,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export class PlacementController {
  private kind: PlaceKind | null = null;
  private readonly ghost: THREE.Mesh;
  private readonly innerRing: THREE.Mesh;
  private readonly guides = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    overlayScene: THREE.Scene,
    private readonly controls: OrbitControls,
    private readonly onPlace: (kind: PlaceKind, pos: THREE.Vector3) => void,
  ) {
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.innerRing = makeRing(PLACEMENT_TUNING.rMin, 0.25);
    this.guides.add(this.ghost, this.innerRing, makeRing(PLACEMENT_TUNING.rMax, 0.1));
    this.guides.visible = false;
    overlayScene.add(this.guides);

    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  get active(): boolean {
    return this.kind !== null;
  }

  enter(kind: PlaceKind): void {
    this.kind = kind;
    const look = KIND_LOOKS[kind];
    this.ghost.scale.setScalar(look.radius);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(look.color);
    this.innerRing.scale.setScalar(look.rMin / PLACEMENT_TUNING.rMin);
    this.guides.visible = true;
    this.controls.enabled = false;
  }

  cancel(): void {
    this.kind = null;
    this.guides.visible = false;
    this.controls.enabled = true;
  }

  private updateGhost(event: PointerEvent): boolean {
    if (!this.kind) return false;
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hitPoint)) return false;
    this.ghost.position.copy(clampPlacement(this.hitPoint, KIND_LOOKS[this.kind].rMin));
    return true;
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.kind) return;
    this.updateGhost(event);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.kind || event.button !== 0) return;
    if (!this.updateGhost(event)) return;
    this.onPlace(this.kind, this.ghost.position.clone());
    this.cancel();
  };

  private readonly onContextMenu = (event: Event): void => {
    if (!this.kind) return;
    event.preventDefault();
    this.cancel();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.cancel();
  };
}
