/**
 * Bootstrap and main loop: fixed-timestep simulation, free-running render,
 * with sim state pushed into the GPU passes, audio engine, and HUD once per
 * frame.
 */
import * as THREE from 'three';
import { AudioEngine } from './audio/engine';
import { AimingController } from './interact/aiming';
import { DISC_OUTER, R_ISCO } from './physics/constants';
import type { GravityCenter } from './physics/geodesic';
import { BlackHolePass, type PlanetState } from './render/blackHolePass';
import { CameraRig } from './render/cameraRig';
import { CameraTour } from './render/cameraTour';
import { DebrisPoints } from './render/debrisPoints';
import { PhotonPathManager } from './render/photonPaths';
import { RenderPipeline, type AccumMode } from './render/pipeline';
import { generateStarCubemap } from './render/starfield';
import { defaultSettings } from './settings';
import { displayRs, orbitalOmegaWall } from './sim/binary';
import { bodyScale } from './sim/body';
import { clearBody, createWorld, placeBinary, placeBody, stepWorld } from './sim/world';
import type { Body } from './sim/types';
import { buildPanel } from './ui/panel';
import { PlacementController } from './ui/placement';

const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

const BODY_APPEARANCE: Record<Body['kind'], { color: THREE.Color; emissive: number }> = {
  planet: { color: new THREE.Color(0.62, 0.47, 0.36), emissive: 0 },
  star: { color: new THREE.Color(1.0, 0.82, 0.55), emissive: 6 },
};

/**
 * Temporal accumulation is only safe when the camera is idle and nothing in
 * the raymarched image moves: paused scenes converge progressively; a live
 * but empty scene gets a light exponential average; anything moving in the
 * shader (body, binary) disables it.
 */
function chooseAccumMode(idle: boolean, paused: boolean, contentMoving: boolean): AccumMode {
  if (!idle) return 'off';
  if (paused) return 'progressive';
  if (contentMoving) return 'off';
  return 'exp';
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} container`);
  return el;
}

const app = requireElement('app');
const hud = requireElement('hud');

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
if (!renderer.capabilities.isWebGL2) {
  hud.textContent = 'This visualizer needs WebGL2, which this browser does not provide.';
  throw new Error('WebGL2 required');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const settings = defaultSettings();
const world = createWorld();

const sky = generateStarCubemap(renderer, { faceSize: 1024 });
const rig = new CameraRig(window.innerWidth / window.innerHeight, renderer.domElement);
const bhPass = new BlackHolePass(sky, settings.quality);
const pipeline = new RenderPipeline(renderer, rig.camera, bhPass, settings.quality);
const tour = new CameraTour();
const audio = new AudioEngine();

const debrisPoints = new DebrisPoints(world.debris);
pipeline.overlayScene.add(debrisPoints.points);

/** Current effective primary r_s (animated during merger ringdown). */
function currentRs(): number {
  return displayRs(world.binary, world.primaryRs);
}

/** Lensing centers for CPU photon paths, mirroring the shader's state. */
function gravityCenters(): readonly GravityCenter[] {
  const centers: GravityCenter[] = [{ x: 0, y: 0, z: 0, rs: currentRs() }];
  const binary = world.binary;
  if (binary?.phase === 'inspiral') {
    centers.push({ x: binary.pos.x, y: binary.pos.y, z: binary.pos.z, rs: binary.rs2 });
  }
  return centers;
}

const photonPaths = new PhotonPathManager(gravityCenters);
photonPaths.setVisible(settings.photonsEnabled);
pipeline.overlayScene.add(photonPaths.group);

function endTour(): void {
  tour.cancel();
  rig.controls.enabled = true;
}

const placement = new PlacementController(
  rig.camera,
  renderer.domElement,
  pipeline.overlayScene,
  rig.controls,
  (kind, pos) => {
    if (kind === 'bh2') placeBinary(world, pos);
    else placeBody(world, kind, pos, settings.tdeMode);
  },
);
let aimInfo = '';
const aiming = new AimingController(
  renderer.domElement,
  rig.camera,
  photonPaths,
  settings,
  () => placement.active || tour.activeKind !== null,
  (text) => {
    aimInfo = text;
  },
);

const gui = buildPanel(
  settings,
  {
    placePlanet: () => placement.enter('planet'),
    placeStar: () => placement.enter('star'),
    placeBlackHole: () => placement.enter('bh2'),
    clearBody: () => clearBody(world),
    clearPaths: () => photonPaths.clear(),
    onPhotonsToggled: (enabled) => {
      photonPaths.setVisible(enabled);
      if (enabled) aiming.launchTowardHole();
    },
    onQualityChange: (quality) => pipeline.setQuality(quality),
    startTour: (kind) => {
      placement.cancel();
      rig.controls.enabled = false;
      tour.start(kind, rig.camera, currentRs());
    },
    stopTour: endTour,
    onSoundToggled: (enabled) => {
      audio.unlock();
      audio.setEnabled(enabled);
    },
    onVolumeChange: (volume) => audio.setVolume(volume),
  },
  new URLSearchParams(window.location.search).has('debug'),
);
audio.setVolume(settings.volume);

// Browsers only allow audio after a user gesture; arm it on the first one.
window.addEventListener(
  'pointerdown',
  () => {
    audio.unlock();
    audio.setEnabled(settings.soundEnabled);
  },
  { once: true },
);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') endTour();
});

const drawSize = new THREE.Vector2();
function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  rig.setAspect(window.innerWidth / window.innerHeight);
  renderer.getDrawingBufferSize(drawSize);
  pipeline.setSize(drawSize.x, drawSize.y);
}
resize();
window.addEventListener('resize', resize);

// --- planet uniform sync (scratch objects, no per-frame allocation) ---
const planetState: PlanetState = {
  pos: new THREE.Vector3(),
  radii: new THREE.Vector3(),
  rot: new THREE.Matrix3(),
  color: new THREE.Color(),
  emissive: 0,
};
const axisToHole = new THREE.Vector3();
const sideA = new THREE.Vector3();
const sideB = new THREE.Vector3();
const pickAxis = new THREE.Vector3();

function syncPlanet(body: Body | null): void {
  if (!body) {
    bhPass.setPlanet(null);
    return;
  }
  const { axial, lateral } = bodyScale(body);
  planetState.pos.copy(body.pos);
  planetState.radii.set(lateral, axial, lateral).multiplyScalar(body.radius0);
  axisToHole.copy(body.pos).multiplyScalar(-1).normalize();
  pickAxis.set(0, 1, 0);
  if (Math.abs(axisToHole.y) > 0.99) pickAxis.set(1, 0, 0);
  sideA.crossVectors(pickAxis, axisToHole).normalize();
  sideB.crossVectors(sideA, axisToHole);
  // Columns: (sideA, axisToHole, sideB); local +Y is the stretch axis.
  planetState.rot.set(
    sideA.x, axisToHole.x, sideB.x,
    sideA.y, axisToHole.y, sideB.y,
    sideA.z, axisToHole.z, sideB.z,
  );
  const look = BODY_APPEARANCE[body.kind];
  planetState.color.copy(look.color);
  planetState.emissive = look.emissive;
  bhPass.setPlanet(planetState);
}

// --- auto-degrade on sustained slow frames ---
const frameTimes: number[] = [];
let lastDegradeCheck = 0;
let degradeNote = '';

function maybeDegrade(now: number, frameMs: number): void {
  frameTimes.push(frameMs);
  if (frameTimes.length > 120) frameTimes.shift();
  if (now - lastDegradeCheck < 2500 || frameTimes.length < 60) return;
  lastDegradeCheck = now;
  const median = [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)]!;
  if (median <= 24 || settings.quality === 'low') return;
  settings.quality = settings.quality === 'high' ? 'medium' : 'low';
  pipeline.setQuality(settings.quality);
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  degradeNote = `quality lowered to ${settings.quality} (slow frames)`;
  frameTimes.length = 0;
}

// --- HUD ---
let lastHudUpdate = 0;
let transientNote = '';
let transientUntil = 0;

function updateHud(now: number, fps: number): void {
  if (now - lastHudUpdate < 250) return;
  lastHudUpdate = now;
  const lines = [`${fps.toFixed(0)} fps · ${settings.quality}`];
  const binary = world.binary;
  if (binary?.phase === 'inspiral') {
    const orbitsPerSec = orbitalOmegaWall(binary, world.primaryRs, settings.gwTimeCompression) /
      (2 * Math.PI);
    lines.push(
      `inspiral: separation ${binary.a.toFixed(2)} rₛ · ${orbitsPerSec.toFixed(2)} orbits/s`,
    );
  } else if (binary?.phase === 'ringdown') {
    lines.push('merged — ringdown');
  }
  if (world.body) {
    lines.push(
      `${world.body.kind} (${world.body.mode}): ${world.body.phase} · r=${world.body.pos
        .length()
        .toFixed(1)} · mass=${(world.body.mass * 100).toFixed(0)}%`,
    );
  }
  if (world.discBoost > 0.01) lines.push(`disc feed +${(world.discBoost * 100).toFixed(0)}%`);
  if (tour.activeKind) lines.push(`camera flight: ${tour.activeKind} · Esc to stop`);
  else if (placement.active) lines.push('click the plane to place · right-click / Esc cancels');
  else if (settings.photonsEnabled) lines.push('click to launch photons');
  if (aimInfo) lines.push(aimInfo);
  if (now < transientUntil) lines.push(transientNote);
  if (degradeNote) lines.push(degradeNote);
  hud.textContent = lines.join('\n');
}

// --- main loop ---
let last = performance.now();
let acc = 0;
let smoothedFps = 60;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;
  smoothedFps += (1 / Math.max(frameDt, 1e-4) - smoothedFps) * 0.05;

  if (!settings.paused) acc += frameDt * settings.timeScale;
  let steps = 0;
  let mergerNow = false;
  let shredNow = false;
  while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    const events = stepWorld(world, FIXED_DT, Math.random, settings.gwTimeCompression);
    mergerNow ||= events.mergerNow;
    shredNow ||= events.shredNow;
    if (events.bodyEscaped) {
      transientNote = 'remnant escaped with the mass it kept';
      transientUntil = now + 5000;
    }
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0; // spiral-of-death guard

  if (mergerNow) audio.onMerger();
  if (shredNow) audio.onShred();

  const rs = currentRs();
  syncPlanet(world.body);
  bhPass.setPrimaryRs(rs);
  bhPass.setSecondary(
    world.binary?.phase === 'inspiral' ? { pos: world.binary.pos, rs: world.binary.rs2 } : null,
  );
  bhPass.setDisc({
    inner: R_ISCO * rs,
    outer: DISC_OUTER * rs,
    brightness: settings.discEnabled ? settings.discBrightness * (1 + world.discBoost) : 0,
  });
  renderer.getDrawingBufferSize(drawSize);
  debrisPoints.update(world.debris, world.debrisBrightness, rig.camera, drawSize.y);

  audio.update(frameDt, {
    discBoost: world.discBoost,
    binary:
      world.binary?.phase === 'inspiral'
        ? {
            separation: world.binary.a,
            omegaWall: orbitalOmegaWall(world.binary, world.primaryRs, settings.gwTimeCompression),
          }
        : null,
    primaryRs: rs,
  });

  // Camera: a flight tour owns it while active; orbit controls otherwise.
  let idle = false;
  if (tour.activeKind) {
    const stillFlying = tour.update(frameDt, rig.camera);
    if (!stillFlying) endTour();
  } else {
    idle = rig.update();
  }

  const bhContentMoving = world.body !== null || world.binary !== null;
  const accumMode = chooseAccumMode(idle, settings.paused, bhContentMoving);
  pipeline.render(world.time, {
    accumMode,
    bloomStrength: settings.bloomStrength,
    fade: tour.fade,
  });

  maybeDegrade(now, frameDt * 1000);
  updateHud(now, smoothedFps);
}
requestAnimationFrame(frame);
