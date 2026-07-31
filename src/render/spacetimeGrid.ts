/**
 * The curvature of the spacetime around the hole, drawn the textbook way: a
 * polar wireframe lying on Flamm's paraboloid (the exact Schwarzschild
 * embedding diagram), with the binary's gravitational waves rippling outward
 * across it.
 *
 * The mesh is built once and never touched again, the vertex shader places
 * every vertex from r, phi and a handful of uniforms, so an inspiral costs
 * nothing on the CPU.
 */
import * as THREE from 'three';
import { GRID_TUNING } from '../config';
import type { WaveState } from '../sim/gravitationalWave';
import { maskUniforms } from './horizonMask';
import gridVert from './shaders/grid.vert';
import gridFrag from './shaders/grid.frag';

/** z(r) of Flamm's paraboloid in r_s = 1 units. */
function embeddingDepth(radius: number, rs: number): number {
  return 2 * Math.sqrt(Math.max(rs * (radius - rs), 0));
}

/**
 * Rings spaced geometrically (dense where the funnel actually bends) crossed
 * by straight spokes, emitted as line segments on the flat plane; the vertex
 * shader lifts them onto the funnel.
 */
function buildWireframe(): THREE.BufferGeometry {
  const { innerRadius, outerRadius, ringCount, spokeCount, ringSegments } = GRID_TUNING;
  const growth = (outerRadius / innerRadius) ** (1 / (ringCount - 1));
  const radii = Array.from({ length: ringCount }, (_, i) => innerRadius * growth ** i);
  const points: number[] = [];

  const pushSegment = (r0: number, a0: number, r1: number, a1: number): void => {
    points.push(r0 * Math.cos(a0), 0, r0 * Math.sin(a0));
    points.push(r1 * Math.cos(a1), 0, r1 * Math.sin(a1));
  };

  for (const radius of radii) {
    for (let s = 0; s < ringSegments; s++) {
      const a0 = (s / ringSegments) * Math.PI * 2;
      const a1 = ((s + 1) / ringSegments) * Math.PI * 2;
      pushSegment(radius, a0, radius, a1);
    }
  }
  for (let s = 0; s < spokeCount; s++) {
    const angle = (s / spokeCount) * Math.PI * 2;
    for (let i = 0; i < radii.length - 1; i++) {
      pushSegment(radii[i]!, angle, radii[i + 1]!, angle);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return geometry;
}

export class SpacetimeGrid {
  readonly lines: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: gridVert,
      fragmentShader: gridFrag,
      uniforms: {
        ...maskUniforms,
        uRs: { value: 1 },
        uRimDepth: { value: embeddingDepth(GRID_TUNING.outerRadius, 1) },
        uDepthScale: { value: GRID_TUNING.depthScale },
        uWaveAmp: { value: 0 },
        uWaveNumber: { value: 0 },
        uWavePhase: { value: 0 },
        uColor: { value: new THREE.Color(GRID_TUNING.color) },
        uOpacity: { value: GRID_TUNING.opacity },
        uFadeStart: { value: GRID_TUNING.outerRadius * 0.72 },
        uFadeEnd: { value: GRID_TUNING.outerRadius },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.lines = new THREE.LineSegments(buildWireframe(), this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  setVisible(visible: boolean): void {
    this.lines.visible = visible;
  }

  /** The funnel deepens as the hole grows (after a merger, say). */
  setPrimaryRs(rs: number): void {
    this.material.uniforms.uRs!.value = rs;
    this.material.uniforms.uRimDepth!.value = embeddingDepth(GRID_TUNING.outerRadius, rs);
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity!.value = opacity;
  }

  setWave(wave: WaveState): void {
    this.material.uniforms.uWaveAmp!.value = wave.amplitude;
    this.material.uniforms.uWaveNumber!.value = wave.wavenumber;
    this.material.uniforms.uWavePhase!.value = wave.phase;
  }
}
