/**
 * Owns every render target and the 4-pass frame graph:
 *
 *   1. BH raymarch  -> rtBH (internal scale, alpha = horizon mask)
 *      (+ progressive accumulation into a ping-pong pair while idle)
 *   2. overlay scene -> rtScene (full res: debris, photon paths, gizmos)
 *   3. bloom chain on the combined HDR
 *   4. composite -> canvas (ACES, gamma, dither)
 */
import * as THREE from 'three';
import type { QualityPreset } from '../settings';
import { BlackHolePass } from './blackHolePass';
import { BloomChain } from './bloom';
import { FullscreenPass } from './fullscreenPass';
import { updateMaskUniforms } from './horizonMask';
import accumFrag from './shaders/accum.frag';
import combineFrag from './shaders/combine.frag';
import compositeFrag from './shaders/composite.frag';

const INTERNAL_SCALE: Record<QualityPreset, number> = { low: 0.5, medium: 0.75, high: 1.0 };
const MAX_ACCUM_FRAMES = 128;

/** Sub-pixel jitter sequence (Halton-ish), centered on zero. */
const JITTER: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.0, -0.17],
  [-0.25, 0.16],
  [0.25, -0.39],
  [-0.375, -0.06],
  [0.125, 0.27],
  [-0.125, -0.28],
  [0.375, 0.05],
];

function makeTarget(width: number, height: number, depth: boolean): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(width, 1), Math.max(height, 1), {
    type: THREE.HalfFloatType,
    depthBuffer: depth,
    generateMipmaps: false,
  });
}

/**
 * Temporal accumulation mode for the raymarch:
 * - 'off': camera or in-shader content is moving; single unjittered frame.
 * - 'exp': idle but the disc still animates; short exponential average
 *   (light anti-aliasing, bounded motion blur).
 * - 'progressive': idle and paused; running average that converges to a
 *   supersampled frame, then holds it and skips the raymarch entirely.
 */
export type AccumMode = 'off' | 'exp' | 'progressive';

export interface FrameOptions {
  accumMode: AccumMode;
  bloomStrength: number;
  /** Composite brightness multiplier (camera-tour fade), 1 for full brightness. */
  fade: number;
}

export class RenderPipeline {
  /** Overlay objects (debris, photon paths, gizmos) get added here. */
  readonly overlayScene = new THREE.Scene();

  private rtBH: THREE.WebGLRenderTarget;
  private rtScene: THREE.WebGLRenderTarget;
  private rtHDR: THREE.WebGLRenderTarget;
  private accumA: THREE.WebGLRenderTarget;
  private accumB: THREE.WebGLRenderTarget;
  private accumCount = 0;

  private readonly bloom = new BloomChain();
  private readonly combinePass: FullscreenPass;
  private readonly accumPass: FullscreenPass;
  private readonly compositePass: FullscreenPass;

  private width = 2;
  private height = 2;
  private quality: QualityPreset;
  private readonly jitterScratch = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    readonly bhPass: BlackHolePass,
    quality: QualityPreset,
  ) {
    this.quality = quality;
    this.rtBH = makeTarget(2, 2, false);
    this.rtScene = makeTarget(2, 2, true);
    this.rtHDR = makeTarget(2, 2, false);
    this.accumA = makeTarget(2, 2, false);
    this.accumB = makeTarget(2, 2, false);
    this.combinePass = new FullscreenPass(combineFrag, {
      tBH: { value: null },
      tScene: { value: null },
      uOutRes: { value: new THREE.Vector2() },
    });
    this.accumPass = new FullscreenPass(accumFrag, {
      tCur: { value: null },
      tPrev: { value: null },
      uOutRes: { value: new THREE.Vector2() },
      uBlend: { value: 1 },
    });
    this.compositePass = new FullscreenPass(compositeFrag, {
      tHDR: { value: null },
      tBloom: { value: null },
      uOutRes: { value: new THREE.Vector2() },
      uBloomStrength: { value: 1 },
      uFade: { value: 1 },
    });
    renderer.setClearColor(0x000000, 0);
  }

  setQuality(quality: QualityPreset): void {
    this.quality = quality;
    this.bhPass.setQuality(quality);
    this.allocate();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(Math.floor(width), 2);
    this.height = Math.max(Math.floor(height), 2);
    this.allocate();
  }

  resetAccumulation(): void {
    this.accumCount = 0;
  }

  /** The ping-pong target most recently written by the accumulation pass. */
  private lastAccumTarget(): THREE.WebGLRenderTarget {
    return (this.accumCount - 1) % 2 === 0 ? this.accumB : this.accumA;
  }

  private allocate(): void {
    for (const rt of [this.rtBH, this.rtScene, this.rtHDR, this.accumA, this.accumB]) {
      rt.dispose();
    }
    const scale = INTERNAL_SCALE[this.quality];
    const bw = Math.floor(this.width * scale);
    const bh = Math.floor(this.height * scale);
    this.rtBH = makeTarget(bw, bh, false);
    this.accumA = makeTarget(bw, bh, false);
    this.accumB = makeTarget(bw, bh, false);
    this.rtScene = makeTarget(this.width, this.height, true);
    this.rtHDR = makeTarget(this.width, this.height, false);
    this.bloom.setSize(this.width, this.height);
    this.accumCount = 0;
  }

  render(time: number, options: FrameOptions): void {
    const renderer = this.renderer;
    const mode = options.accumMode;
    const hold = mode === 'progressive' && this.accumCount >= MAX_ACCUM_FRAMES;

    // Pass 1: raymarch (jittered while accumulating; skipped while holding
    // a converged progressive average).
    if (!hold) {
      const j = mode === 'off' ? JITTER[0]! : JITTER[this.accumCount % JITTER.length]!;
      this.bhPass.updateCamera(this.camera, this.jitterScratch.set(j[0], j[1]));
      this.bhPass.render(renderer, this.rtBH, time);
    }

    let bhTexture: THREE.Texture = this.rtBH.texture;
    if (mode === 'off') {
      this.accumCount = 0;
    } else if (hold) {
      bhTexture = this.lastAccumTarget().texture;
    } else {
      const prev = this.accumCount % 2 === 0 ? this.accumA : this.accumB;
      const next = this.accumCount % 2 === 0 ? this.accumB : this.accumA;
      const progressiveBlend = 1 / (this.accumCount + 1);
      const u = this.accumPass.material.uniforms;
      u.tCur!.value = this.rtBH.texture;
      u.tPrev!.value = prev.texture;
      u.uBlend!.value = mode === 'exp' ? Math.max(0.2, progressiveBlend) : progressiveBlend;
      (u.uOutRes!.value as THREE.Vector2).set(next.width, next.height);
      this.accumPass.render(renderer, next);
      bhTexture = next.texture;
      this.accumCount++;
    }

    // Pass 2: overlay scene with horizon occlusion.
    updateMaskUniforms(this.rtBH.texture, this.width, this.height, this.camera.position);
    renderer.setRenderTarget(this.rtScene);
    renderer.clear();
    renderer.render(this.overlayScene, this.camera);

    // Combine to full-res HDR.
    const cu = this.combinePass.material.uniforms;
    cu.tBH!.value = bhTexture;
    cu.tScene!.value = this.rtScene.texture;
    (cu.uOutRes!.value as THREE.Vector2).set(this.width, this.height);
    this.combinePass.render(renderer, this.rtHDR);

    // Pass 3: bloom.
    const bloomTexture = this.bloom.run(renderer, this.rtHDR.texture);

    // Pass 4: composite to the canvas.
    const pu = this.compositePass.material.uniforms;
    pu.tHDR!.value = this.rtHDR.texture;
    pu.tBloom!.value = bloomTexture;
    pu.uBloomStrength!.value = options.bloomStrength;
    pu.uFade!.value = options.fade;
    (pu.uOutRes!.value as THREE.Vector2).set(this.width, this.height);
    this.compositePass.render(renderer, null);
  }
}
