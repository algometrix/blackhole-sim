/**
 * The lil-gui control panel, bound directly to the plain settings object.
 * A hidden tuning folder for art-directing the debris stream appears with
 * `?debug=1`.
 */
import GUI from 'lil-gui';
import { BODY_TUNING, DEBRIS_TUNING, DISC_TUNING } from '../config';
import type { QualityPreset, Settings } from '../settings';
import type { TourKind } from '../render/cameraTour';

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
}

export function buildPanel(settings: Settings, actions: PanelActions, debug: boolean): GUI {
  const gui = new GUI({ title: 'Black Hole' });

  const body = gui.addFolder('Place');
  body.add(actions, 'placePlanet').name('Place planet');
  body.add(actions, 'placeStar').name('Place star');
  body.add(actions, 'placeBlackHole').name('Place black hole');
  body.add(actions, 'clearBody').name('Clear body');
  body
    .add(settings, 'tdeMode', { 'Cinematic spiral': 'cinematic', 'Realistic TDE': 'realistic' })
    .name('Disruption mode');

  const sim = gui.addFolder('Simulation');
  sim.add(settings, 'paused').name('Paused');
  sim.add(settings, 'timeScale', 0.1, 3, 0.05).name('Time scale');
  sim.add(settings, 'gwTimeCompression', 1, 200, 1).name('GW time ×');

  const camera = gui.addFolder('Camera');
  camera.add({ flyIn: () => actions.startTour('flyin') }, 'flyIn').name('Fly in (plunge)');
  camera.add({ flyBy: () => actions.startTour('flyby') }, 'flyBy').name('Fly past');
  camera.add({ circle: () => actions.startTour('circle') }, 'circle').name('Circle orbit');
  camera.add(actions, 'stopTour').name('Stop flight');

  const disc = gui.addFolder('Disc');
  disc.add(settings, 'discEnabled').name('Enabled');
  disc.add(settings, 'discBrightness', 0, 3, 0.05).name('Brightness');

  const paths = gui.addFolder('Light paths');
  paths.add(settings, 'photonsEnabled').name('Enabled').onChange(actions.onPhotonsToggled);
  paths.add(settings, 'photonCount', 1, 32, 1).name('Rays per launch');
  paths.add(settings, 'photonSpreadDeg', 0, 30, 0.5).name('Spread (deg)');
  paths.add(actions, 'clearPaths').name('Clear paths');

  const sound = gui.addFolder('Sound');
  sound.add(settings, 'soundEnabled').name('Enabled').onChange(actions.onSoundToggled);
  sound.add(settings, 'volume', 0, 1, 0.01).name('Volume').onChange(actions.onVolumeChange);

  const render = gui.addFolder('Render');
  render.add(settings, 'bloomStrength', 0, 3, 0.05).name('Bloom');
  render
    .add(settings, 'quality', ['low', 'medium', 'high'])
    .name('Quality')
    .onChange(actions.onQualityChange);

  if (debug) {
    const tuning = gui.addFolder('Tuning (debug)');
    tuning.add(BODY_TUNING, 'drag', 0, 0.1, 0.001).name('Body drag');
    tuning.add(BODY_TUNING, 'rTidal', 3, 10, 0.1).name('Tidal radius');
    tuning.add(BODY_TUNING, 'rShed', 2, 8, 0.1).name('Shed radius');
    tuning.add(BODY_TUNING, 'massLossBase', 0.01, 0.5, 0.005).name('Mass loss rate');
    tuning.add(DEBRIS_TUNING, 'drag', 0, 0.3, 0.005).name('Debris drag');
    tuning.add(DEBRIS_TUNING, 'planeSpring', 0, 3, 0.05).name('Plane spring');
    tuning.add(DEBRIS_TUNING, 'planeDamping', 0, 4, 0.05).name('Plane damping');
    tuning.add(DEBRIS_TUNING, 'spawnJitter', 0, 1, 0.01).name('Spawn jitter');
    tuning.add(DEBRIS_TUNING, 'spawnKick', 0, 1, 0.01).name('Spawn kick');
    tuning.add(DISC_TUNING, 'boostDecayTau', 1, 30, 0.5).name('Boost decay tau');
  }
  return gui;
}
