/**
 * A reusable fullscreen-triangle pass: one geometry, one ShaderMaterial,
 * rendered into a target (or the canvas when target is null).
 */
import * as THREE from 'three';
import fullscreenVert from './shaders/fullscreen.vert';

const dummyCamera = new THREE.Camera();

function fullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  return geometry;
}

export class FullscreenPass {
  readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();

  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(fullscreenTriangle(), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, dummyCamera);
  }
}
