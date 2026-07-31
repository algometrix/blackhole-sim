/**
 * Pass 3: dual-filter Kawase bloom, threshold prefilter, a downsample chain,
 * then tent upsampling that accumulates each level back up.
 */
import * as THREE from 'three';
import { FullscreenPass } from './fullscreenPass';
import prefilterFrag from './shaders/prefilter.frag';
import downFrag from './shaders/bloomDown.frag';
import upFrag from './shaders/bloomUp.frag';

/**
 * Six levels, not four. The dual-filter kernel is a diamond; with only four
 * levels its widest tail is still bright enough after tonemapping that the
 * diamond's isoline shows up as straight-edged polygons wherever a very bright
 * region borders a black one, most visibly around the shadow itself.
 */
const LEVELS = 6;

function makeTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(width, 1), Math.max(height, 1), {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

export class BloomChain {
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly prefilter: FullscreenPass;
  private readonly downPass: FullscreenPass;
  private readonly upPass: FullscreenPass;

  constructor(threshold = 1.0) {
    this.prefilter = new FullscreenPass(prefilterFrag, {
      tSrc: { value: null },
      uOutRes: { value: new THREE.Vector2() },
      uThreshold: { value: threshold },
    });
    this.downPass = new FullscreenPass(downFrag, {
      tSrc: { value: null },
      uOutRes: { value: new THREE.Vector2() },
      uHalfPixel: { value: new THREE.Vector2() },
    });
    this.upPass = new FullscreenPass(upFrag, {
      tSrc: { value: null },
      tAdd: { value: null },
      uOutRes: { value: new THREE.Vector2() },
      uHalfPixel: { value: new THREE.Vector2() },
    });
  }

  setSize(width: number, height: number): void {
    for (const rt of [...this.down, ...this.up]) rt.dispose();
    this.down = [];
    this.up = [];
    for (let i = 0; i < LEVELS; i++) {
      const w = Math.floor(width / 2 ** (i + 1));
      const h = Math.floor(height / 2 ** (i + 1));
      this.down.push(makeTarget(w, h));
      this.up.push(makeTarget(w, h));
    }
  }

  /** Runs the chain on `source` and returns the half-res bloom texture. */
  run(renderer: THREE.WebGLRenderer, source: THREE.Texture): THREE.Texture {
    const down = this.down;
    const first = down[0]!;
    this.prefilter.material.uniforms.tSrc!.value = source;
    (this.prefilter.material.uniforms.uOutRes!.value as THREE.Vector2).set(
      first.width,
      first.height,
    );
    this.prefilter.render(renderer, first);

    for (let i = 1; i < LEVELS; i++) {
      const src = down[i - 1]!;
      const dst = down[i]!;
      const u = this.downPass.material.uniforms;
      u.tSrc!.value = src.texture;
      (u.uOutRes!.value as THREE.Vector2).set(dst.width, dst.height);
      (u.uHalfPixel!.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
      this.downPass.render(renderer, dst);
    }

    let smaller = down[LEVELS - 1]!;
    for (let i = LEVELS - 2; i >= 0; i--) {
      const dst = this.up[i]!;
      const u = this.upPass.material.uniforms;
      u.tSrc!.value = smaller.texture;
      u.tAdd!.value = down[i]!.texture;
      (u.uOutRes!.value as THREE.Vector2).set(dst.width, dst.height);
      (u.uHalfPixel!.value as THREE.Vector2).set(0.5 / smaller.width, 0.5 / smaller.height);
      this.upPass.render(renderer, dst);
      smaller = dst;
    }
    return smaller.texture;
  }
}
