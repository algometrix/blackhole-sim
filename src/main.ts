/**
 * Bootstrap and main loop: fixed-timestep simulation, free-running render,
 * with sim state pushed into the GPU passes, audio engine, and HUD once per
 * frame.
 */
import * as THREE from 'three';
import { AudioEngine } from './audio/engine';
import { AimingController } from './interact/aiming';
import { BEACON_TUNING } from './config';
import { DISC_OUTER } from './physics/constants';
import type { GravityCenter } from './physics/geodesic';
import {
  circularPhotonOrbitRadius,
  horizonRadius,
  innermostStableCircularOrbit,
} from './physics/kerr';
import { lorentzGamma } from './physics/relativity';
import { BeaconPoint, type BeaconState } from './render/beaconPoint';
import { BlackHolePass, type PlanetState } from './render/blackHolePass';
import { CameraRig } from './render/cameraRig';
import { CameraTour } from './render/cameraTour';
import { DebrisPoints } from './render/debrisPoints';
import { PhotonPathManager, type LensingState } from './render/photonPaths';
import { RenderPipeline, type AccumMode } from './render/pipeline';
import { SpacetimeGrid } from './render/spacetimeGrid';
import { Starfield } from './render/starfield';
import { defaultSettings } from './settings';
import { observeBeacon, releasePoint, type BeaconObservables } from './sim/beacon';
import { displayRs, orbitalOmegaWall } from './sim/binary';
import { bodyScale } from './sim/body';
import { nextWaveState, restingWave } from './sim/gravitationalWave';
import {
  clearBeacon,
  clearBody,
  createWorld,
  placeBeacon,
  placeBinary,
  placeBody,
  resetScene,
  setPrimarySpin,
  stepWorld,
} from './sim/world';
import type { Body } from './sim/types';
import { CinematicMode, isTypingIntoControl } from './ui/chrome';
import { touchRenderBudget, usesTouchUi } from './ui/device';
import { buildPanel } from './ui/panel';
import type { Preset } from './ui/presets';
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
const toast = requireElement('toast');
const chromeToggle = requireElement('chrome-toggle');

// A finger-driven device gets the touch layout and a smaller render budget,
// phone or tablet alike. Decided once at boot: a device does not grow a mouse
// mid-session, and re-laying-out the panel on every orientation change would
// be worse than the sizes being slightly off in landscape.
const touchUi = usesTouchUi();
if (touchUi) document.body.classList.add('touch-ui');
const budget = touchRenderBudget();

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
});
if (!renderer.capabilities.isWebGL2) {
  hud.textContent = 'This visualizer needs WebGL2, which this browser does not provide.';
  throw new Error('WebGL2 required');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, touchUi ? budget.pixelRatio : 2));
app.appendChild(renderer.domElement);

const settings = defaultSettings();
if (touchUi) settings.quality = 'low';
const world = createWorld();

const starfield = new Starfield(renderer, settings.sky, touchUi ? budget.skyFaceSize : undefined);
const rig = new CameraRig(window.innerWidth / window.innerHeight, renderer.domElement);
const bhPass = new BlackHolePass(starfield.texture, settings.quality);
const pipeline = new RenderPipeline(renderer, rig.camera, bhPass, settings.quality);
const tour = new CameraTour();
const audio = new AudioEngine();

const debrisPoints = new DebrisPoints(world.debris);
pipeline.overlayScene.add(debrisPoints.points);

const beaconPoint = new BeaconPoint();
pipeline.overlayScene.add(beaconPoint.points);

const spacetimeGrid = new SpacetimeGrid();
pipeline.overlayScene.add(spacetimeGrid.lines);

/** Current effective primary r_s (animated during merger ringdown). */
function currentRs(): number {
  return displayRs(world.binary, world.primaryRs);
}

/** The spacetime CPU photon paths integrate in, mirroring the shader's state. */
function lensingState(): LensingState {
  const centers: GravityCenter[] = [{ x: 0, y: 0, z: 0, rs: currentRs() }];
  const binary = world.binary;
  if (binary?.phase === 'inspiral') {
    centers.push({ x: binary.pos.x, y: binary.pos.y, z: binary.pos.z, rs: binary.rs2 });
  }
  return { centers, spin: world.spin };
}

const photonPaths = new PhotonPathManager(lensingState);
photonPaths.setVisible(settings.photonsEnabled);
pipeline.overlayScene.add(photonPaths.group);

/** Gravitational-wave state for the curvature grid; advanced on sim time. */
let wave = restingWave();

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
    // `pos` already carries whatever lift the kind asked for, so the beacon
    // arrives at its release point and not at the click on the plane.
    if (kind === 'bh2') placeBinary(world, pos);
    else if (kind === 'beacon') placeBeacon(world, pos);
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

const cinematic = new CinematicMode(
  document.body,
  toast,
  touchUi ? 'tap the button to bring them back' : 'press H for the controls',
);
chromeToggle.addEventListener('click', () => {
  cinematic.toggle();
  chromeToggle.setAttribute(
    'aria-label',
    cinematic.isActive ? 'Show the interface' : 'Hide the interface',
  );
});

/** A re-bake invalidates the converged idle frame, so accumulation restarts. */
function rebakeSky(): void {
  starfield.bake(settings.sky);
  pipeline.resetAccumulation();
}

const presetPos = new THREE.Vector3();

/**
 * Build a canned scene: clear whatever is there, place what the preset asks
 * for, move the camera, force its look settings. Settings the preset does not
 * mention keep their current values.
 */
function applyPreset(preset: Preset): void {
  endTour();
  placement.cancel();
  resetScene(world);
  wave = restingWave();

  const { sky, ...look } = preset.look;
  Object.assign(settings, look);
  if (sky) {
    Object.assign(settings.sky, sky);
    rebakeSky();
  }

  if (preset.body) {
    const { kind, radius, angle } = preset.body;
    presetPos.set(radius * Math.cos(angle), 0, radius * Math.sin(angle));
    placeBody(world, kind, presetPos, settings.tdeMode);
  }
  if (preset.binary) {
    const { radius, angle } = preset.binary;
    presetPos.set(radius * Math.cos(angle), 0, radius * Math.sin(angle));
    placeBinary(world, presetPos);
  }
  if (preset.beacon) {
    const { radius, angle } = preset.beacon;
    presetPos.set(radius * Math.cos(angle), 0, radius * Math.sin(angle));
    placeBeacon(world, releasePoint(presetPos));
  }

  rig.moveTo(preset.camera);
  photonPaths.setVisible(settings.photonsEnabled);
  // A preset can change the spacetime itself, so a converged still frame from
  // the previous scene is no longer a picture of anything.
  pipeline.resetAccumulation();
  panel.refreshDisplays();
  if (preset.cinematic) cinematic.hide();
  else cinematic.show();
  if (preset.tour) {
    rig.controls.enabled = false;
    tour.start(preset.tour, rig.camera, currentRs());
  }
  showTransientNote(preset.name);
}

const panel = buildPanel(
  settings,
  {
    placePlanet: () => placement.enter('planet'),
    placeStar: () => placement.enter('star'),
    placeBlackHole: () => placement.enter('bh2'),
    placeBeacon: () => placement.enter('beacon'),
    clearBody: () => clearBody(world),
    clearBeacon: () => clearBeacon(world),
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
    onSkyChange: rebakeSky,
    newSky: () => {
      settings.sky.seed = Math.random() * 1000;
      rebakeSky();
    },
    toggleCinematic: () => cinematic.toggle(),
    applyPreset,
    refreshFromSettings: () => {
      pipeline.setQuality(settings.quality);
      photonPaths.setVisible(settings.photonsEnabled);
      audio.setEnabled(settings.soundEnabled);
      audio.setVolume(settings.volume);
      rebakeSky();
    },
  },
  { debug: new URLSearchParams(window.location.search).has('debug'), compact: touchUi },
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
// The whole keymap, in one place: Esc ends a camera flight, H hides the
// interface, G toggles the curvature grid.
window.addEventListener('keydown', (event) => {
  if (isTypingIntoControl(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  switch (event.key.toLowerCase()) {
    case 'escape':
      endTour();
      break;
    case 'h':
      cinematic.toggle();
      break;
    case 'g':
      settings.gridEnabled = !settings.gridEnabled;
      panel.refreshDisplays();
      break;
  }
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

// --- spin, and the accumulation it invalidates ---
//
// Changing the spin changes the spacetime, so a converged progressive frame is
// a picture of a different universe and has to be thrown away, exactly as a
// sky re-bake does. The same goes for the image-order overlay: in 'progressive'
// mode the raymarch is skipped once converged, so a paused user toggling it
// would otherwise see nothing happen at all.
let appliedSpin = 0;
let appliedImageOrderTint = 0;
let spinWasAvailable = true;

function syncSpin(): void {
  const available = world.binary === null;
  if (available !== spinWasAvailable) {
    spinWasAvailable = available;
    panel.setSpinAvailable(available);
    if (!available && settings.spin > 0) {
      showTransientNote('spin is modelled for a single hole, so it was set to 0');
    }
  }
  const spin = setPrimarySpin(world, settings.spin);
  if (spin !== appliedSpin) {
    appliedSpin = spin;
    pipeline.resetAccumulation();
  }
}

function syncImageOrderTint(): void {
  const tint = settings.imageOrderTintEnabled ? settings.imageOrderTintStrength : 0;
  bhPass.setImageOrderTint(tint);
  if (tint === appliedImageOrderTint) return;
  appliedImageOrderTint = tint;
  pipeline.resetAccumulation();
}

// --- infalling beacon sync (scratch object, no per-frame allocation) ---
const beaconState: BeaconState = {
  pos: new THREE.Vector3(),
  radius: BEACON_TUNING.radius,
  redshift: 1,
  brightness: 1,
};

/**
 * What a distant observer measures about the probe right now, recomputed once
 * per frame and shared by the renderer and the readout. Null when there is no
 * probe in the scene.
 */
let beaconView: BeaconObservables | null = null;

function syncBeacon(view: BeaconObservables | null, viewportHeight: number): void {
  const beacon = world.beacon;
  if (!beacon || !view) {
    beaconPoint.hide();
    return;
  }
  // Drawn at the apparent radius, not the coordinate radius: near the horizon
  // the image piles up on the photon ring instead of sinking into the shadow.
  beaconState.pos.copy(beacon.direction).multiplyScalar(view.apparentRadius);
  beaconState.radius = BEACON_TUNING.radius * beacon.horizonRs;
  beaconState.redshift = view.redshift;
  beaconState.brightness = BEACON_TUNING.emission * settings.beaconBrightness;
  beaconPoint.setBeacon(beaconState, rig.camera, viewportHeight);
}

// --- auto-degrade on sustained slow frames ---
const frameTimes: number[] = [];
let lastDegradeCheck = 0;

function maybeDegrade(now: number, frameMs: number): void {
  frameTimes.push(frameMs);
  if (frameTimes.length > 120) frameTimes.shift();
  if (now - lastDegradeCheck < 2500 || frameTimes.length < 60) return;
  lastDegradeCheck = now;
  const median = [...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)]!;
  if (median <= 24 || settings.quality === 'low') return;
  settings.quality = settings.quality === 'high' ? 'medium' : 'low';
  pipeline.setQuality(settings.quality);
  panel.refreshDisplays();
  showTransientNote(`quality lowered to ${settings.quality} (slow frames)`);
  frameTimes.length = 0;
}

// --- HUD ---
const NOTE_VISIBLE_MS = 4500;
let lastHudUpdate = 0;
let transientNote = '';
let transientUntil = 0;

/** A one-off line in the readout, e.g. "remnant escaped". */
function showTransientNote(text: string): void {
  transientNote = text;
  transientUntil = performance.now() + NOTE_VISIBLE_MS;
}

/**
 * Compact number for the readout. The beacon's quantities span thirty decades
 * on the way down, so a fixed number of decimal places is useless for them.
 */
function readable(value: number): string {
  return value >= 0.01 ? value.toFixed(2) : value.toExponential(1);
}

function updateHud(now: number, fps: number): void {
  if (cinematic.isActive || now - lastHudUpdate < 250) return;
  lastHudUpdate = now;
  const lines = [`${fps.toFixed(0)} fps · ${settings.quality}`];
  if (world.spin > 0) {
    // Derived radii belong in the readout, which is where this app already
    // puts live numbers, rather than in the panel next to the slider.
    lines.push(
      `spin a/M ${world.spin.toFixed(2)} · horizon ${horizonRadius(world.spin).toFixed(2)} rₛ · ` +
        `ISCO ${innermostStableCircularOrbit(world.spin, 'prograde').toFixed(2)} rₛ · ` +
        `photon ring ${circularPhotonOrbitRadius(world.spin, 'prograde').toFixed(2)} / ` +
        `${circularPhotonOrbitRadius(world.spin, 'retrograde').toFixed(2)} rₛ (prograde / retrograde)`,
    );
  }
  const binary = world.binary;
  if (binary?.phase === 'inspiral') {
    const orbitsPerSec = orbitalOmegaWall(binary, world.primaryRs, settings.gwTimeCompression) /
      (2 * Math.PI);
    lines.push(
      `inspiral: separation ${binary.a.toFixed(2)} rₛ · ${orbitsPerSec.toFixed(2)} orbits/s`,
    );
  } else if (binary?.phase === 'ringdown') {
    lines.push('merged, ringdown');
  }
  if (world.body) {
    lines.push(
      `${world.body.kind} (${world.body.mode}): ${world.body.phase} · r=${world.body.pos
        .length()
        .toFixed(1)} · mass=${(world.body.mass * 100).toFixed(0)}%`,
    );
  }
  if (beaconView) {
    const view = beaconView;
    lines.push(
      `beacon (${view.settled ? 'frozen' : 'falling'}): r − rₛ = ${readable(view.horizonGap)}` +
        ` · redshift ×${readable(view.redshift)} · your clock ${view.coordinateTime.toFixed(0)} rₛ/c`,
    );
    lines.push(
      `  its own clock ${view.probeProperTime.toFixed(1)} of` +
        ` ${view.probeProperTimeAtHorizon.toFixed(1)} rₛ/c to the horizon`,
    );
  }
  if (world.discBoost > 0.01) lines.push(`disc feed +${(world.discBoost * 100).toFixed(0)}%`);
  if (tour.activeKind) {
    const speed = cameraBeta.length();
    const motion =
      speed > 0.005 ? ` · ${speed.toFixed(2)} c · γ ${lorentzGamma(speed).toFixed(2)}` : '';
    lines.push(`camera flight: ${tour.activeKind}${motion} · Esc to stop`);
  } else if (placement.active) {
    lines.push('click the plane to place · right-click / Esc cancels');
  } else if (settings.photonsEnabled) {
    lines.push('click to launch photons');
  }
  if (settings.imageOrderTintEnabled) {
    lines.push('image order: blue direct · amber one half turn · magenta photon ring');
  }
  if (aimInfo) lines.push(aimInfo);
  if (now < transientUntil) lines.push(transientNote);
  hud.textContent = lines.join('\n');
}

// --- main loop ---
/** Scratch for the camera velocity pushed to the shader; never allocated per frame. */
const cameraBeta = new THREE.Vector3();
/** The three compressed clocks, refilled from the sliders each tick. */
const clocks = { gw: 0, tde: 0, beacon: 0 };
let last = performance.now();
let acc = 0;
let smoothedFps = 60;

function frame(now: number): void {
  requestAnimationFrame(frame);
  // Clamped at both ends. The ceiling is the usual "don't simulate a whole
  // alt-tab in one tick" guard; the floor matters because the first frame's
  // timestamp can predate `last`, a browser hands the callback the time the
  // frame started, which on a slow GPU is before the startup sky bake
  // finished. That negative dt used to drive the accumulator tens of seconds
  // into debt, and the simulation stood still until it climbed back out.
  const frameDt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
  last = now;
  smoothedFps += (1 / Math.max(frameDt, 1e-4) - smoothedFps) * 0.05;

  if (!settings.paused) acc += frameDt * settings.timeScale;
  let steps = 0;
  let mergerNow = false;
  let shredNow = false;
  clocks.gw = settings.gwTimeCompression;
  clocks.tde = settings.tdeTimeCompression;
  clocks.beacon = settings.beaconTimeCompression;
  while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    const events = stepWorld(world, FIXED_DT, clocks, Math.random);
    mergerNow ||= events.mergerNow;
    shredNow ||= events.shredNow;
    if (events.bodyEscaped) showTransientNote('remnant escaped with the mass it kept');
    if (events.beaconLost) showTransientNote('the merger moved the horizon, so the beacon was removed');
    // The wave rides the simulation clock, so it freezes when the sim does.
    wave = nextWaveState(
      wave,
      world.binary,
      world.primaryRs,
      settings.gwTimeCompression,
      FIXED_DT,
    );
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0; // spiral-of-death guard

  if (mergerNow) audio.onMerger();
  if (shredNow) audio.onShred();

  const rs = currentRs();
  syncPlanet(world.body);
  syncSpin();
  bhPass.setPrimary({ rs, spin: world.spin });
  bhPass.setSecondary(
    world.binary?.phase === 'inspiral' ? { pos: world.binary.pos, rs: world.binary.rs2 } : null,
  );
  bhPass.setJetStrength(settings.jetEnabled ? settings.jetStrength : 0);
  // The outflow exists only while the hole is being force-fed, so it rises
  // with the feeding boost and dies with it, no separate control needed.
  bhPass.setWindStrength(settings.windEnabled ? world.discBoost * settings.windStrength : 0);
  syncImageOrderTint();
  spacetimeGrid.setVisible(settings.gridEnabled);
  spacetimeGrid.setOpacity(settings.gridOpacity);
  spacetimeGrid.setPrimaryRs(rs);
  spacetimeGrid.setWave(wave);
  bhPass.setDisc({
    inner: innermostStableCircularOrbit(world.spin, 'prograde') * rs,
    outer: DISC_OUTER * rs,
    brightness: settings.discEnabled ? settings.discBrightness * (1 + world.discBoost) : 0,
  });
  renderer.getDrawingBufferSize(drawSize);
  debrisPoints.update(world.debris, world.debrisBrightness, rig.camera, drawSize.y);
  // Measured once, then shared by the sprite and the (throttled) readout.
  beaconView = world.beacon ? observeBeacon(world.beacon) : null;
  syncBeacon(beaconView, drawSize.y);

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

  // Relativistic optics of the moving camera. Mouse orbiting repositions the
  // camera rather than flying it, so the tour's beta is the zero vector there
  // and the whole effect is off by construction, not by a threshold.
  cameraBeta
    .copy(tour.beta)
    .multiplyScalar(settings.cameraBoostEnabled ? settings.cameraBoostStrength : 0);
  bhPass.setCameraBeta(cameraBeta);

  // Only raymarched content counts. The beacon is drawn in the overlay pass,
  // which is re-rendered every frame even while a converged raymarch is held,
  // so a falling probe does not have to spoil idle accumulation.
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
