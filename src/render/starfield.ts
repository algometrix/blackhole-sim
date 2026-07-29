/**
 * Bakes the procedural starfield into an HDR cubemap once at startup. The
 * geodesic shader samples it along each escaped ray's bent direction, which
 * is what smears stars into lensed arcs near the shadow for free.
 */
import * as THREE from 'three';
import skyVert from './shaders/sky.vert';
import skyFrag from './shaders/sky.frag';

export interface StarfieldOptions {
  faceSize?: number;
  seed?: number;
}

export function generateStarCubemap(
  renderer: THREE.WebGLRenderer,
  options: StarfieldOptions = {},
): THREE.CubeTexture {
  const faceSize = options.faceSize ?? 1024;
  const seed = options.seed ?? 3.7;

  const target = new THREE.WebGLCubeRenderTarget(faceSize, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
  });
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: { uSeed: { value: seed } },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), material);
  scene.add(mesh);

  const cubeCamera = new THREE.CubeCamera(0.1, 100, target);
  cubeCamera.update(renderer, scene);

  mesh.geometry.dispose();
  material.dispose();
  return target.texture;
}
