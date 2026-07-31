/**
 * GPU rendering of the sim's debris pool: one THREE.Points wrapping the
 * pool's Float32Arrays directly (zero copy), each frame just flips
 * needsUpdate and sets drawRange to the live count.
 */
import * as THREE from 'three';
import type { DebrisPool } from '../sim/types';
import { maskUniforms } from './horizonMask';
import debrisVert from './shaders/debris.vert';
import debrisFrag from './shaders/debris.frag';

export class DebrisPoints {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(pool: DebrisPool) {
    this.geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pool.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const heatAttr = new THREE.BufferAttribute(pool.heat, 1).setUsage(THREE.DynamicDrawUsage);
    const lifeAttr = new THREE.BufferAttribute(pool.life, 1).setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(pool.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('aHeat', heatAttr);
    this.geometry.setAttribute('aLife', lifeAttr);
    this.geometry.setAttribute('aSize', sizeAttr);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: debrisVert,
      fragmentShader: debrisFrag,
      uniforms: {
        ...maskUniforms,
        uBrightness: { value: 1 },
        uPixelScale: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  update(
    pool: DebrisPool,
    brightness: number,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ): void {
    this.geometry.setDrawRange(0, pool.alive);
    for (const name of ['position', 'aHeat', 'aLife', 'aSize'] as const) {
      (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
    this.material.uniforms.uBrightness!.value = brightness;
    this.material.uniforms.uPixelScale!.value =
      viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
