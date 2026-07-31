/**
 * The lil-gui control panel, bound directly to the plain settings object.
 *
 * Folders are ordered the way someone actually uses the app: first put
 * something in the scene, then control time, then the camera, then how it all
 * looks. Only the first two are open on load; everything else is one click
 * away, and every control carries a hover description of what it does.
 *
 * A hidden tuning folder for art-directing the debris stream appears with
 * `?debug=1`.
 */
import GUI, { type Controller } from 'lil-gui';
import { BODY_TUNING, DEBRIS_TUNING, DISC_TUNING } from '../config';
import { A_STAR_MAX } from '../physics/constants';
import { defaultSettings, type QualityPreset, type Settings } from '../settings';
import type { TourKind } from '../render/cameraTour';
import { PRESETS, type Preset } from './presets';

/**
 * The numbers quoted here are asserted in physics/__tests__/kerr.test.ts, so
 * the tooltip cannot drift away from what the app actually renders.
 */
const SPIN_TOOLTIP =
  'How fast the hole turns, as a fraction of the fastest it can. 0 is a still hole and gives the classic image. Turn it up and the hole drags space around with it: the shadow goes lopsided, with its prograde edge pulled in to 1.06 rₛ while the far edge swings out to 3.50 rₛ, the horizon shrinks from 1 rₛ to 0.53 rₛ, and the disc’s inner edge follows the last stable orbit in from 3 rₛ to 0.62 rₛ, so the inner disc runs hotter and much faster. 0.998 is the Thorne limit, the fastest a hole fed by a disc can spin, because the last photons it swallows spin it back down. Spin roughly doubles the cost of a frame.';

const SPIN_UNAVAILABLE_TOOLTIP =
  'Two holes are superposed rather than solved, and there is no spinning version of that, so spin is off while a second hole is in the scene.';

export interface PanelActions {
  placePlanet(): void;
  placeStar(): void;
  placeBlackHole(): void;
  clearBody(): void;
  clearPaths(): void;
  onPhotonsToggled(enabled: boolean): void;
  onQualityChange(quality: QualityPreset): void;
  startTour(kind: TourKind): void;
  stopTour(): void;
  onSoundToggled(enabled: boolean): void;
  onVolumeChange(volume: number): void;
  /** Re-bake the sky cubemap after a sky control settles. */
  onSkyChange(): void;
  /** Reseed and re-bake: a whole new sky. */
  newSky(): void;
  toggleCinematic(): void;
  /** Build one of the canned scenes (see ui/presets.ts). */
  applyPreset(preset: Preset): void;
  /** Re-run the side effects of settings that changed without their control. */
  refreshFromSettings(): void;
}

/** Hover text: the panel has no room to explain itself, the tooltip does. */
function explain(controller: Controller, text: string): Controller {
  controller.domElement.title = text;
  return controller;
}

/**
 * A "reset this section" button. `restore` both writes the shipped defaults
 * back and re-fires whatever side effects those settings drive (a sky re-bake,
 * a quality change); this only repaints the folder afterwards.
 */
function addResetButton(folder: GUI, restore: () => void, tooltip: string): void {
  const action = {
    reset: () => {
      restore();
      folder.controllersRecursive().forEach((controller) => controller.updateDisplay());
    },
  };
  explain(folder.add(action, 'reset').name('↺ Reset this section'), tooltip);
}

export interface ControlPanel {
  gui: GUI;
  /** Repaint every control from the settings object it is bound to. */
  refreshDisplays(): void;
  /**
   * Enable or disable the spin slider. Kerr is a single-hole solution, so a
   * second hole in the scene takes the control away rather than letting the
   * user set a value the renderer will silently ignore.
   */
  setSpinAvailable(available: boolean): void;
}

export interface PanelOptions {
  /** Show the hidden art-direction folder (`?debug=1`). */
  debug: boolean;
  /**
   * Phone layout: the panel is a bottom sheet, so it starts collapsed to its
   * title bar. Opening it covers most of a phone screen, which is fine when
   * asked for and intolerable by default.
   */
  compact: boolean;
}

export function buildPanel(
  settings: Settings,
  actions: PanelActions,
  { debug, compact }: PanelOptions,
): ControlPanel {
  const gui = new GUI({ title: 'Black Hole' });
  if (compact) {
    // The title bar is the only thing on screen while the sheet is shut, so it
    // has to say what tapping it does, and stay honest once it is open.
    const describeState = (): void => {
      gui.title(gui._closed ? 'Black Hole  ·  tap to open' : 'Black Hole  ·  tap to close');
    };
    gui.onOpenClose(describeState);
    describeState();
  } else {
    gui.title('Black Hole  ·  H hides this');
  }
  const shipped = defaultSettings();

  const presets = gui.addFolder('0 · Presets');
  for (const preset of PRESETS) {
    explain(
      presets.add({ run: () => actions.applyPreset(preset) }, 'run').name(preset.name),
      preset.description,
    );
  }

  const scene = gui.addFolder('1 · Drop something in');
  explain(
    scene.add(actions, 'placePlanet').name('Planet'),
    'Arms placement, then click the disc plane. A rocky body: it stretches, then sheds a thin debris stream.',
  );
  explain(
    scene.add(actions, 'placeStar').name('Star'),
    'Arms placement, then click the disc plane. A star shreds into a bright glowing stream that feeds and brightens the disc.',
  );
  explain(
    scene.add(actions, 'placeBlackHole').name('Second black hole'),
    'Arms placement, then click the disc plane. Its orbit decays by gravitational waves until the pair merges; both holes bend light.',
  );
  explain(
    scene.add(actions, 'clearBody').name('Remove body'),
    'Removes the body immediately. Debris already shed keeps draining into the disc.',
  );
  explain(
    scene
      .add(settings, 'tdeMode', {
        'Cinematic spiral (slow, directable)': 'cinematic',
        'Realistic TDE (one violent pass)': 'realistic',
      })
      .name('Disruption physics'),
    'Cinematic: a slow inward spiral you can watch. Realistic: a parabolic plunge shredded at pericenter, with about half the debris flung back out, what real tidal disruptions do.',
  );

  const playback = gui.addFolder('2 · Time');
  explain(
    playback.add(settings, 'paused').name('Pause'),
    'Freezes the simulation. The camera still works, and a still frame keeps refining itself while nothing moves.',
  );
  explain(
    playback.add(settings, 'timeScale', 0.1, 3, 0.05).name('Speed'),
    'Simulation speed multiplier: 1 is real time for this scene, 3 makes a disruption unfold three times faster.',
  );
  explain(
    playback.add(settings, 'gwTimeCompression', 1, 600, 1).name('Inspiral speed'),
    'Wall-clock compression of a binary inspiral. Does nothing until a second black hole is in the scene. The orbit rate responds immediately, but the separation decays as 1/a³, so a wide pair barely moves at any setting and then falls together very fast at the end. That acceleration is the chirp, and it is the real Peters solution.',
  );
  explain(
    playback.add(settings, 'tdeTimeCompression', 1, 60, 1).name('Disruption speed'),
    'Wall-clock compression of a disruption and its debris. Same trick as the inspiral clock: the orbits are exact, the clock is fast, at 1:1 the debris would take ten minutes to complete one lap around the hole.',
  );
  addResetButton(
    playback,
    () => {
      settings.paused = shipped.paused;
      settings.timeScale = shipped.timeScale;
      settings.gwTimeCompression = shipped.gwTimeCompression;
      settings.tdeTimeCompression = shipped.tdeTimeCompression;
    },
    'Back to running, speed ×1, and the default inspiral and disruption clocks.',
  );

  const camera = gui.addFolder('Camera');
  explain(
    camera.add({ flyIn: () => actions.startTour('flyin') }, 'flyIn').name('Fly in (plunge)'),
    'Dives from the current view toward the horizon and fades out. Esc stops any flight.',
  );
  explain(
    camera.add({ flyBy: () => actions.startTour('flyby') }, 'flyBy').name('Fly past'),
    'Sweeps past the hole on a close trajectory, so the lensing shears across the frame.',
  );
  explain(
    camera.add({ circle: () => actions.startTour('circle') }, 'circle').name('Orbit the hole'),
    'A slow circular pass around the disc.',
  );
  explain(
    camera.add(actions, 'stopTour').name('Stop flight (Esc)'),
    'Ends the flight and hands the camera back to mouse control.',
  );
  explain(
    camera.add(settings, 'cameraBoostEnabled').name('Relativistic view'),
    'Applies the real optics of a fast camera while a flight is running. The star field bunches toward the direction of travel, the sky ahead blueshifts and brightens, the sky behind reddens and dims, and the shadow itself shifts with them. Nothing changes while you orbit with the mouse: that camera is being repositioned, not flown.',
  );
  explain(
    camera.add(settings, 'cameraBoostStrength', 0, 1, 0.05).name('Flight speed'),
    'Fraction of the flight’s real speed the optics are computed from. At 1 you get the speed the move would actually have: about 0.33c circling at 5.5 rₛ, 0.41c at the closest point of a fly past, and up to 0.95c at the end of a plunge. At 0.5 you see the same flight at half that speed, and at 0 the effect is exactly off.',
  );
  explain(
    camera.add(actions, 'toggleCinematic').name(compact ? 'Hide the interface' : 'Hide the interface (H)'),
    'Cinematic mode: fades this panel and the readout for a clean, wallpaper-like frame.',
  );
  camera.close();

  // Above the disc folder because spin moves the disc's inner edge: this is
  // the control that decides where the gas is allowed to start.
  const hole = gui.addFolder('Black hole');
  const spinController = explain(
    hole.add(settings, 'spin', 0, A_STAR_MAX, 0.002).name('Spin (a/M)'),
    SPIN_TOOLTIP,
  );
  addResetButton(
    hole,
    () => {
      settings.spin = shipped.spin;
    },
    'Back to a still, non-spinning hole.',
  );
  hole.close();

  const disc = gui.addFolder('Accretion disc');
  explain(
    disc.add(settings, 'discEnabled').name('Show'),
    'The gas orbiting the hole. Turning it off leaves the bare shadow, the photon ring and the lensed sky.',
  );
  explain(
    disc.add(settings, 'discBrightness', 0, 3, 0.05).name('Brightness'),
    'Overall disc emission. Debris falling in adds a temporary boost on top of this.',
  );
  explain(
    disc.add(settings, 'windEnabled').name('Feeding outflow'),
    'When a disruption dumps matter on the disc it goes super-Eddington and drives a broad, ragged wind out of the poles. It appears only while the disc is being fed, and fades as the feeding does.',
  );
  explain(
    disc.add(settings, 'windStrength', 0, 3, 0.05).name('Outflow brightness'),
    'How bright that wind is at full feeding.',
  );
  addResetButton(
    disc,
    () => {
      settings.discEnabled = shipped.discEnabled;
      settings.discBrightness = shipped.discBrightness;
      settings.windEnabled = shipped.windEnabled;
      settings.windStrength = shipped.windStrength;
    },
    'Disc and outflow back to defaults.',
  );
  disc.close();

  const jet = gui.addFolder('Relativistic jet');
  explain(
    jet.add(settings, 'jetEnabled').name('Show'),
    'Twin polar beams along the disc axis. The brightness difference between the two is real Doppler beaming: the cone pointing at you is boosted, the far one is dimmed.',
  );
  explain(
    jet.add(settings, 'jetStrength', 0, 3, 0.05).name('Brightness'),
    'Jet emission. The plasma speed is art-directed; the beaming and the lensing of the beams are not.',
  );
  addResetButton(
    jet,
    () => {
      settings.jetEnabled = shipped.jetEnabled;
      settings.jetStrength = shipped.jetStrength;
    },
    'Jet off, default brightness.',
  );
  jet.close();

  // Sky sliders re-bake a cubemap, so they fire on release, not on drag.
  const sky = gui.addFolder('Deep sky');
  explain(
    sky
      .add(settings.sky, 'starDensity', 0.2, 3, 0.05)
      .name('Star density')
      .onFinishChange(actions.onSkyChange),
    'How crowded the star field is. Stars pile up in the galactic band and in cluster cores. Rebuilds the sky cubemap when you let go.',
  );
  explain(
    sky
      .add(settings.sky, 'starBrightness', 0.2, 3, 0.05)
      .name('Star brightness')
      .onFinishChange(actions.onSkyChange),
    'Brightness of every star layer. The brightest stars grow diffraction spikes and bloom.',
  );
  explain(
    sky
      .add(settings.sky, 'nebulaIntensity', 0, 3, 0.05)
      .name('Nebulae & dust')
      .onFinishChange(actions.onSkyChange),
    'The galactic band, its dark dust lanes and the emission nebulae. Set it to 0 for a plain black sky.',
  );
  explain(
    sky
      .add(settings.sky, 'deepSkyIntensity', 0, 3, 0.05)
      .name('Galaxies & clusters')
      .onFinishChange(actions.onSkyChange),
    'Distant galaxies and globular clusters. Near the shadow the lensing stretches them into arcs.',
  );
  explain(
    sky.add(actions, 'newSky').name('Generate a new sky'),
    'Reseeds every procedural layer: a completely different star field, band and set of galaxies.',
  );
  addResetButton(
    sky,
    () => {
      Object.assign(settings.sky, shipped.sky, { seed: settings.sky.seed });
      actions.onSkyChange();
    },
    'Default sky intensities, keeping the sky you are looking at.',
  );
  sky.close();

  const spacetime = gui.addFolder('Spacetime');
  explain(
    spacetime.add(settings, 'gridEnabled').name('Curvature grid (G)'),
    "Flamm's paraboloid, the standard embedding diagram of the curvature around the hole. During an inspiral the binary's gravitational waves ripple outward across it.",
  );
  explain(
    spacetime.add(settings, 'gridOpacity', 0, 1, 0.02).name('Grid opacity'),
    'How strongly the wireframe is drawn over the scene.',
  );
  spacetime.close();

  const paths = gui.addFolder('Light rays');
  explain(
    paths.add(settings, 'photonsEnabled').name('Show').onChange(actions.onPhotonsToggled),
    'Then click anywhere to launch a fan of photons and watch their true paths: escaped, captured, or trapped near the photon ring.',
  );
  explain(
    paths.add(settings, 'photonCount', 1, 32, 1).name('Rays per launch'),
    'How many rays each click fires.',
  );
  explain(
    paths.add(settings, 'photonSpreadDeg', 0, 30, 0.5).name('Spread (deg)'),
    'Angular width of the fan. A narrow fan near the critical impact parameter shows rays splitting between capture and escape.',
  );
  explain(paths.add(actions, 'clearPaths').name('Clear rays'), 'Removes every drawn ray.');
  explain(
    paths.add(settings, 'imageOrderTintEnabled').name('Tint image orders'),
    'Diagnostic overlay. Colours the disc by how far the light wound around the hole before it reached you: blue is the direct view, amber is light that came round the far side once, magenta is the photon ring, two or more half turns. Only the hue changes, the brightness is left alone.',
  );
  explain(
    paths.add(settings, 'imageOrderTintStrength', 0, 1, 0.05).name('Tint strength'),
    'How far the disc colour is pushed toward the diagnostic hue. 0 leaves the disc alone, 1 replaces its colour entirely and keeps its brightness. The second-order band is thinner than a pixel at normal framing, so pause and let the frame settle to see it.',
  );
  paths.close();

  const sound = gui.addFolder('Sound');
  explain(
    sound.add(settings, 'soundEnabled').name('Enabled').onChange(actions.onSoundToggled),
    'A deep drone, matter rush while the disc is feeding, and a LIGO-style chirp that tracks the real orbital frequency during an inspiral. Browsers need one click on the page first.',
  );
  explain(
    sound.add(settings, 'volume', 0, 1, 0.01).name('Volume').onChange(actions.onVolumeChange),
    'Master volume for the procedural audio.',
  );
  sound.close();

  const render = gui.addFolder('Display');
  explain(
    render.add(settings, 'bloomStrength', 0, 3, 0.05).name('Glow'),
    'Strength of the bloom around bright things. Lower it to see more structure in the disc.',
  );
  explain(
    render
      .add(settings, 'quality', ['low', 'medium', 'high'])
      .name('Quality')
      .onChange(actions.onQualityChange),
    'Raymarch steps and internal resolution. It drops automatically if frames get slow.',
  );
  addResetButton(
    render,
    () => {
      settings.bloomStrength = shipped.bloomStrength;
      settings.quality = shipped.quality;
      actions.onQualityChange(settings.quality);
    },
    'Default glow and quality preset.',
  );
  render.close();

  if (compact) {
    // Presets are the one folder worth having open on a phone: they are the
    // fastest way to something worth looking at.
    scene.close();
    playback.close();
    gui.close();
  }

  const refreshDisplays = (): void => {
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };

  explain(
    gui.add(
      {
        resetAll: () => {
          // In place: every controller holds a reference to `settings` and to
          // `settings.sky`, so replacing either object orphans half the panel.
          const { sky, ...flat } = shipped;
          Object.assign(settings, flat);
          Object.assign(settings.sky, sky, { seed: settings.sky.seed });
          refreshDisplays();
          actions.refreshFromSettings();
        },
      },
      'resetAll',
    ).name('↺ Reset everything'),
    'Every setting back to how the app ships. Whatever is in the scene stays.',
  );

  if (debug) {
    // Only knobs that are read live belong here. The body's own thresholds
    // (tidal radius, shed radius, drag, mass-loss rate) are snapshotted into
    // the Body when it is placed, so a slider for them would move nothing.
    const tuning = gui.addFolder('Tuning (debug)');
    explain(tuning.add(BODY_TUNING, 'stretchMax', 2, 30, 0.5).name('Max stretch'), 'Longest the body is drawn out.');
    explain(tuning.add(DEBRIS_TUNING, 'drag', 0, 0.3, 0.005).name('Debris drag'), 'How fast debris circularizes and feeds the disc.');
    explain(tuning.add(DEBRIS_TUNING, 'planeSpring', 0, 3, 0.05).name('Plane spring'), 'How hard debris is pulled into the disc plane.');
    explain(tuning.add(DEBRIS_TUNING, 'planeDamping', 0, 4, 0.05).name('Plane damping'), 'Damping on that settling.');
    explain(tuning.add(DEBRIS_TUNING, 'spawnJitter', 0, 1, 0.01).name('Spawn jitter'), 'Spread of debris across the strand.');
    explain(tuning.add(DEBRIS_TUNING, 'spawnKick', 0, 1, 0.01).name('Spawn kick'), 'Inward kick given to fresh cinematic-mode debris.');
    explain(tuning.add(DEBRIS_TUNING, 'pointSize', 0.02, 0.8, 0.01).name('Debris size'), 'Sprite radius in world units; affects newly spawned particles.');
    explain(tuning.add(DISC_TUNING, 'boostDecayTau', 1, 30, 0.5).name('Boost decay tau'), 'How long a disc feeding boost lingers.');
    tuning.close();
  }

  const setSpinAvailable = (available: boolean): void => {
    if (available) spinController.enable();
    else spinController.disable();
    spinController.domElement.title = available ? SPIN_TOOLTIP : SPIN_UNAVAILABLE_TOOLTIP;
  };

  return { gui, refreshDisplays, setSpinAvailable };
}
