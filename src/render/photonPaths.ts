/**
 * Photon trajectory rendering: CPU-integrated geodesics drawn as glowing
 * tubes. Paths are true spatial curves (deliberately not re-lensed — the
 * point is to show the actual trajectory geometry, not its lensed image),
 * occluded by the horizon via the shared mask.
 */
import * as THREE from 'three';
import { B_CRIT } from '../physics/constants';
import {
  integrateNullGeodesic,
  type GeodesicResult,
  type GravityCenter,
} from '../physics/geodesic';
import { maskUniforms } from './horizonMask';
import pathVert from './shaders/path.vert';
import pathFrag from './shaders/path.frag';

const MAX_PATHS = 48;
const TUBE_RADIUS = 0.035;
const MAX_CURVE_POINTS = 260;

type PathKind = 'escaped' | 'captured' | 'critical';

const KIND_COLORS: Record<PathKind, THREE.Color> = {
  escaped: new THREE.Color(0.55, 2.0, 2.6),
  captured: new THREE.Color(2.6, 0.9, 0.3),
  critical: new THREE.Color(2.4, 2.4, 2.4),
};

function kindOf(result: GeodesicResult): PathKind {
  if (Math.abs(result.b - B_CRIT) < 0.05) return 'critical';
  return result.fate === 'captured' ? 'captured' : 'escaped';
}

function toCurvePoints(points: Float32Array): THREE.Vector3[] {
  const total = points.length / 3;
  const stride = Math.max(1, Math.ceil(total / MAX_CURVE_POINTS));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < total; i += stride) {
    out.push(new THREE.Vector3(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!));
  }
  const last = total - 1;
  out.push(new THREE.Vector3(points[last * 3]!, points[last * 3 + 1]!, points[last * 3 + 2]!));
  return out;
}

export class PhotonPathManager {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: Record<PathKind, THREE.ShaderMaterial>;

  constructor(private readonly centersProvider: () => readonly GravityCenter[]) {
    const makeMaterial = (kind: PathKind): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: pathVert,
        fragmentShader: pathFrag,
        uniforms: { ...maskUniforms, uColor: { value: KIND_COLORS[kind] } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
    this.materials = {
      escaped: makeMaterial('escaped'),
      captured: makeMaterial('captured'),
      critical: makeMaterial('critical'),
    };
  }

  /** Integrate and draw one photon; returns the trajectory result. */
  launch(origin: THREE.Vector3, dir: THREE.Vector3): GeodesicResult {
    const result = integrateNullGeodesic(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
      { maxSteps: 6000, recordEvery: 2, centers: this.centersProvider() },
    );
    const curvePoints = toCurvePoints(result.points);
    if (curvePoints.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(curvePoints);
      const segments = Math.min(curvePoints.length * 2, 400);
      const geometry = new THREE.TubeGeometry(curve, segments, TUBE_RADIUS, 6, false);
      const mesh = new THREE.Mesh(geometry, this.materials[kindOf(result)]);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
      while (this.meshes.length > MAX_PATHS) this.removeOldest();
    }
    return result;
  }

  /**
   * Launch a horizontal fan of `count` rays around `baseDir` (spread in
   * degrees, rotated about the camera's up axis) — aiming near the shadow
   * edge makes the capture/escape bifurcation at b_crit visible.
   */
  launchFan(
    origin: THREE.Vector3,
    baseDir: THREE.Vector3,
    up: THREE.Vector3,
    count: number,
    spreadDeg: number,
  ): GeodesicResult[] {
    if (count <= 1) return [this.launch(origin, baseDir)];
    const results: GeodesicResult[] = [];
    const spread = THREE.MathUtils.degToRad(spreadDeg);
    for (let i = 0; i < count; i++) {
      const angle = spread * (i / (count - 1) - 0.5);
      const dir = baseDir.clone().applyAxisAngle(up, angle);
      results.push(this.launch(origin, dir));
    }
    return results;
  }

  clear(): void {
    while (this.meshes.length > 0) this.removeOldest();
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  private removeOldest(): void {
    const mesh = this.meshes.shift();
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
  }
}
