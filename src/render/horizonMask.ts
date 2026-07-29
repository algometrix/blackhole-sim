/**
 * Shared uniforms for the horizon-occlusion mask (the BH pass's alpha
 * channel). Overlay materials reference these exact uniform objects, so one
 * per-frame update reaches every material.
 */
import * as THREE from 'three';

export const maskUniforms = {
  uMaskTex: { value: null as THREE.Texture | null },
  uScreenRes: { value: new THREE.Vector2(1, 1) },
  uCamPosW: { value: new THREE.Vector3() },
};

export function updateMaskUniforms(
  maskTexture: THREE.Texture,
  width: number,
  height: number,
  camPos: THREE.Vector3,
): void {
  maskUniforms.uMaskTex.value = maskTexture;
  maskUniforms.uScreenRes.value.set(width, height);
  maskUniforms.uCamPosW.value.copy(camPos);
}
