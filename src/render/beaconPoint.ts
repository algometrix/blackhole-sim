/**
 * GPU rendering of the infalling probe: one additive point sprite in the
 * overlay pass, occluded by the horizon through the shared mask, exactly the
 * way debrisPoints.ts draws the debris.
 *
 * It is an overlay object rather than a hit test inside the raymarch because
 * the raymarch pass is not this module's to change. The cost is that the probe
 * is not truly lensed: it is drawn at the apparent radius sim/beacon.ts
 * computes for it, which floors the image at the photon ring so it hugs the
 * shadow rim instead of sinking into it, but the position of that image within
 * the rim is a first-order stand-in rather than a solved geodesic.
 */
import * as THREE from 'three';
import { maskUniforms } from './horizonMask';
import beaconVert from './shaders/beacon.vert';
import beaconFrag from './shaders/beacon.frag';

export interface BeaconState {
  /** Where the image appears, world space (not the coordinate position). */
  pos: THREE.Vector3;
  /** Drawn radius, world units. */
  radius: number;
  /** g = received / emitted frequency; drives colour and brightness. */
  redshift: number;
  /** Emission scale times the exposure slider. */
  brightness: number;
}

/**
 * Screen-space floor on the sprite, pixels. At its drawn radius of 0.06 r_s
 * the probe is under two pixels from a normal viewing distance, and a two
 * pixel dot cannot show a colour ramp at all. The floor is a legibility
 * choice, so the probe stays a readable point of light at any distance, and it
 * is why the image never shrinks as it falls: what the fall changes is the
 * colour and the brightness, which is the honest part.
 */
const MIN_SPRITE_PIXELS = 7;

export class BeaconPoint {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly position = new Float32Array(3);

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage),
    );

    this.material = new THREE.ShaderMaterial({
      vertexShader: beaconVert,
      fragmentShader: beaconFrag,
      uniforms: {
        ...maskUniforms,
        uPixelScale: { value: 1 },
        uWorldRadius: { value: 0.06 },
        uMinPixels: { value: MIN_SPRITE_PIXELS },
        uShift: { value: 1 },
        uBrightness: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Take the probe off screen; the draw call goes away with it. */
  hide(): void {
    this.points.visible = false;
  }

  setBeacon(
    beacon: BeaconState,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ): void {
    this.points.visible = true;
    this.position[0] = beacon.pos.x;
    this.position[1] = beacon.pos.y;
    this.position[2] = beacon.pos.z;
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const u = this.material.uniforms;
    u.uWorldRadius!.value = beacon.radius;
    u.uShift!.value = beacon.redshift;
    u.uBrightness!.value = beacon.brightness;
    u.uPixelScale!.value =
      viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
