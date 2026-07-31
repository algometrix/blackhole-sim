/**
 * Bakes the procedural deep sky (stars, galactic band, nebulae, clusters,
 * distant galaxies) into an HDR cubemap. The geodesic shader samples it along
 * each escaped ray's bent direction, which is what smears the whole sky into
 * lensed arcs near the shadow for free.
 *
 * Baking is six faces of a heavy noise shader, so it runs at boot and again
 * only when a sky control settles, never per frame.
 */
import * as THREE from 'three';
import { SKY_TUNING } from '../config';
import type { SkySettings } from '../settings';
import skyVert from './shaders/sky.vert';
import skyFrag from './shaders/sky.frag';

export class Starfield {
  /** Stable across re-bakes, so uniforms holding it never need updating. */
  readonly texture: THREE.CubeTexture;

  private readonly target: THREE.WebGLCubeRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly geometry = new THREE.BoxGeometry(10, 10, 10);
  private readonly material: THREE.ShaderMaterial;
  private readonly cubeCamera: THREE.CubeCamera;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    sky: SkySettings,
  ) {
    this.target = new THREE.WebGLCubeRenderTarget(SKY_TUNING.faceSize, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    });
    this.texture = this.target.texture;
    this.material = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uSeed: { value: sky.seed },
        uStarDensity: { value: sky.starDensity },
        uStarBrightness: { value: sky.starBrightness },
        uNebulaIntensity: { value: sky.nebulaIntensity },
        uDeepSkyIntensity: { value: sky.deepSkyIntensity },
      },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.cubeCamera = new THREE.CubeCamera(0.1, 100, this.target);
    this.bake(sky);
  }

  /** Re-renders all six faces in place with the given sky settings. */
  bake(sky: SkySettings): void {
    const uniforms = this.material.uniforms;
    uniforms.uSeed!.value = sky.seed;
    uniforms.uStarDensity!.value = sky.starDensity;
    uniforms.uStarBrightness!.value = sky.starBrightness;
    uniforms.uNebulaIntensity!.value = sky.nebulaIntensity;
    uniforms.uDeepSkyIntensity!.value = sky.deepSkyIntensity;
    this.cubeCamera.update(this.renderer, this.scene);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
