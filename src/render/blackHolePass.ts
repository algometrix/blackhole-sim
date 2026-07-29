/**
 * Pass 1: the fullscreen GR raymarch. Owns the geodesic ShaderMaterial and
 * its uniforms; everything that must be truly lensed (sky, disc, planet)
 * renders here. Output alpha is the horizon mask.
 */
import * as THREE from 'three';
import { glslDefineMap } from '../physics/constants';
import type { QualityPreset } from '../settings';
import { FullscreenPass } from './fullscreenPass';
import geodesicFrag from './shaders/geodesic.frag';

export interface PlanetState {
  pos: THREE.Vector3;
  /** Ellipsoid radii in the local frame: (lateral, axial-toward-hole, lateral). */
  radii: THREE.Vector3;
  /** Local -> world rotation; local +Y is the stretch axis toward the hole. */
  rot: THREE.Matrix3;
  color: THREE.Color;
  /** 0 for a rocky planet; HDR emissive strength for a star. */
  emissive: number;
}

export interface DiscState {
  inner: number;
  outer: number;
  /** Effective brightness (base * (1 + boost)); 0 disables the disc. */
  brightness: number;
}

const QUALITY_STEPS: Record<QualityPreset, number> = { low: 128, medium: 256, high: 420 };

export class BlackHolePass {
  private readonly pass: FullscreenPass;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(skyTexture: THREE.CubeTexture, quality: QualityPreset) {
    this.uniforms = {
      uCamPos: { value: new THREE.Vector3() },
      uCamBasis: { value: new THREE.Matrix3() },
      uTanHalfFov: { value: 1 },
      uAspect: { value: 1 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uJitter: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uSky: { value: skyTexture },
      uRs: { value: 1 },
      uBh2Active: { value: 0 },
      uBh2Pos: { value: new THREE.Vector3() },
      uBh2Rs: { value: 0.3 },
      uDiscInner: { value: 3 },
      uDiscOuter: { value: 9 },
      uDiscBrightness: { value: 1 },
      uPlanetActive: { value: 0 },
      uPlanetPos: { value: new THREE.Vector3() },
      uPlanetRadii: { value: new THREE.Vector3(1, 1, 1) },
      uPlanetRot: { value: new THREE.Matrix3() },
      uPlanetInvRot: { value: new THREE.Matrix3() },
      uPlanetColor: { value: new THREE.Color(1, 1, 1) },
      uPlanetEmissive: { value: 0 },
    };
    this.pass = new FullscreenPass(geodesicFrag, this.uniforms);
    this.applyDefines(quality);
  }

  private applyDefines(quality: QualityPreset): void {
    this.pass.material.defines = {
      ...glslDefineMap(),
      MAX_STEPS: String(QUALITY_STEPS[quality]),
      USE_RK4: quality === 'low' ? '0' : '1',
      BEAM_EXP: '3.0',
    };
    this.pass.material.needsUpdate = true;
  }

  setQuality(quality: QualityPreset): void {
    this.applyDefines(quality);
  }

  /** Primary Schwarzschild radius (animated during merger/ringdown). */
  setPrimaryRs(rs: number): void {
    this.uniforms.uRs!.value = rs;
  }

  setSecondary(bh2: { pos: THREE.Vector3; rs: number } | null): void {
    if (!bh2) {
      this.uniforms.uBh2Active!.value = 0;
      return;
    }
    this.uniforms.uBh2Active!.value = 1;
    (this.uniforms.uBh2Pos!.value as THREE.Vector3).copy(bh2.pos);
    this.uniforms.uBh2Rs!.value = bh2.rs;
  }

  setDisc(disc: DiscState): void {
    this.uniforms.uDiscInner!.value = disc.inner;
    this.uniforms.uDiscOuter!.value = disc.outer;
    this.uniforms.uDiscBrightness!.value = disc.brightness;
  }

  setPlanet(planet: PlanetState | null): void {
    if (!planet) {
      this.uniforms.uPlanetActive!.value = 0;
      return;
    }
    this.uniforms.uPlanetActive!.value = 1;
    (this.uniforms.uPlanetPos!.value as THREE.Vector3).copy(planet.pos);
    (this.uniforms.uPlanetRadii!.value as THREE.Vector3).copy(planet.radii);
    (this.uniforms.uPlanetRot!.value as THREE.Matrix3).copy(planet.rot);
    (this.uniforms.uPlanetInvRot!.value as THREE.Matrix3).copy(planet.rot).transpose();
    (this.uniforms.uPlanetColor!.value as THREE.Color).copy(planet.color);
    this.uniforms.uPlanetEmissive!.value = planet.emissive;
  }

  updateCamera(camera: THREE.PerspectiveCamera, jitter: THREE.Vector2): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    (this.uniforms.uCamPos!.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld);
    // Columns: camera right, up, back — the shader marches along -back.
    (this.uniforms.uCamBasis!.value as THREE.Matrix3).set(
      e[0]!, e[4]!, e[8]!,
      e[1]!, e[5]!, e[9]!,
      e[2]!, e[6]!, e[10]!,
    );
    this.uniforms.uTanHalfFov!.value = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.uniforms.uAspect!.value = camera.aspect;
    (this.uniforms.uJitter!.value as THREE.Vector2).copy(jitter);
  }

  render(
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget,
    time: number,
  ): void {
    this.uniforms.uTime!.value = time;
    (this.uniforms.uResolution!.value as THREE.Vector2).set(target.width, target.height);
    this.pass.render(renderer, target);
  }
}
