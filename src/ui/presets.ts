/**
 * One-click scenes. Each preset is plain data: what to put in the world, where
 * to stand, and which look settings to force. The panel lists them; main.ts
 * knows how to apply one (it owns the world and the camera).
 *
 * Anything a preset does not mention is left exactly as the user had it.
 */
import type { BodyKind } from '../sim/types';
import type { Settings, SkySettings } from '../settings';
import type { CameraPose } from '../render/cameraRig';
import type { TourKind } from '../render/cameraTour';

/** Where to place a body: polar coordinates on the disc plane, r_s units. */
export interface Placement {
  radius: number;
  /** Angle around the disc plane, radians. */
  angle: number;
}

export interface Preset {
  id: string;
  name: string;
  /** Hover text in the panel: what you are about to see. */
  description: string;
  /**
   * Look settings forced by this preset; everything else is left alone.
   *
   * Deliberately narrowed to the settings the frame loop reads every frame.
   * Anything with a side effect behind it (quality, sound, photon paths) would
   * need its callback re-fired, and a preset that set one would silently do
   * nothing, so the type refuses it instead.
   */
  look: Partial<
    Pick<
      Settings,
      | 'tdeMode'
      | 'timeScale'
      | 'spin'
      | 'gwTimeCompression'
      | 'tdeTimeCompression'
      | 'beaconTimeCompression'
      | 'beaconBrightness'
      | 'discEnabled'
      | 'discBrightness'
      | 'jetEnabled'
      | 'jetStrength'
      | 'windEnabled'
      | 'windStrength'
      | 'gridEnabled'
      | 'gridOpacity'
      | 'bloomStrength'
      | 'cameraBoostEnabled'
      | 'cameraBoostStrength'
    >
  > & { sky?: Partial<SkySettings> };
  body: ({ kind: BodyKind } & Placement) | null;
  binary: Placement | null;
  /** Where to release the infalling probe. Its lift out of the plane is
   *  sim/beacon.ts's business, so only the plane position is given here. */
  beacon: Placement | null;
  camera: CameraPose;
  /** Start a camera flight once the scene is set. */
  tour?: TourKind;
  /** Whether the panel and readout should be hidden. Required, so adding a
   *  preset forces a decision instead of inheriting whatever was on screen. */
  cinematic: boolean;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'devoured',
    name: 'A star being devoured',
    description:
      'A star on a realistic plunge: one violent pass, shredded at pericenter, half the debris flung back out and the rest wound into a glowing stream that feeds the disc.',
    look: { tdeMode: 'realistic', discEnabled: true, discBrightness: 1.0, jetEnabled: false, gridEnabled: false, timeScale: 1, bloomStrength: 1.1 },
    body: { kind: 'star', radius: 14, angle: 2.5 },
    binary: null,
    beacon: null,
    camera: { distance: 27, elevation: 0.25, azimuth: 1.4 },
    cinematic: false,
  },
  {
    id: 'spaghetti',
    name: 'Spaghettification, slowly',
    description:
      'A planet on the cinematic spiral, drawn out into a strand as it crosses the tidal radius. Slow enough to watch the stretch build.',
    look: { tdeMode: 'cinematic', discEnabled: true, discBrightness: 0.8, jetEnabled: false, gridEnabled: false, timeScale: 1.4, bloomStrength: 1.0 },
    body: { kind: 'planet', radius: 11, angle: 0.4 },
    binary: null,
    beacon: null,
    camera: { distance: 22, elevation: 0.30, azimuth: 1.9 },
    cinematic: false,
  },
  {
    id: 'merger',
    name: 'Binary merger with waves',
    description:
      'A second hole spiralling in by the Peters equations, with the curvature grid on so you can watch the gravitational waves spiral outward and chirp.',
    look: { discEnabled: true, discBrightness: 0.55, jetEnabled: false, gridEnabled: true, gridOpacity: 0.5, gwTimeCompression: 40, timeScale: 1, bloomStrength: 1.0 },
    body: null,
    binary: { radius: 13, angle: 0.0 },
    beacon: null,
    camera: { distance: 30, elevation: 0.5, azimuth: 0.9 },
    cinematic: false,
  },
  {
    id: 'curvature',
    name: 'Curved spacetime',
    description:
      "The embedding diagram on its own: Flamm's paraboloid funnelling into the throat, disc off, seen from above the plane.",
    look: { discEnabled: false, jetEnabled: false, gridEnabled: true, gridOpacity: 0.6, bloomStrength: 0.8 },
    body: null,
    binary: null,
    beacon: null,
    camera: { distance: 34, elevation: 0.62, azimuth: 0.4 },
    cinematic: false,
  },
  {
    id: 'quasar',
    name: 'Quasar with jets',
    description:
      'Bright disc, twin relativistic jets, seen nearly edge-on. The near jet is Doppler-boosted, the far one dimmed.',
    look: { discEnabled: true, discBrightness: 1.3, jetEnabled: true, jetStrength: 1.3, gridEnabled: false, bloomStrength: 1.2 },
    body: null,
    binary: null,
    beacon: null,
    camera: { distance: 26, elevation: 0.12, azimuth: 2.2 },
    cinematic: false,
  },
  {
    id: 'kerr',
    name: 'Spinning hole (Kerr)',
    description:
      'A near-extremal hole seen almost edge on. The shadow is visibly D shaped, the bright ring is dragged tight against the horizon on the approaching side, and the disc runs down to 0.97 rₛ, a third of the way in from the 3 rₛ a still hole allows.',
    look: { spin: 0.95, discEnabled: true, discBrightness: 1.1, jetEnabled: false, gridEnabled: false, bloomStrength: 1.0 },
    body: null,
    binary: null,
    beacon: null,
    camera: { distance: 18, elevation: 0.09, azimuth: 1.7 },
    cinematic: false,
  },
  {
    id: 'frozen',
    name: 'A probe frozen at the horizon',
    description:
      'A beacon dropped from rest. It reddens, dims and stalls just outside the shadow instead of crossing. That is what you see; on its own clock it crossed seconds later and felt nothing.',
    // Disc dimmed and outflow off: the probe ends up on the shadow rim, where
    // the inner disc and the photon ring are the brightest things in frame,
    // and by then it is nine decades fainter than it started.
    // spin 0 on purpose: the probe integrates a Schwarzschild radial geodesic
    // anchored to r_s, so demonstrating it against a dragged horizon would be
    // showing one solution inside another spacetime.
    look: { spin: 0, discEnabled: true, discBrightness: 0.5, jetEnabled: false, windEnabled: false, gridEnabled: false, timeScale: 1, beaconTimeCompression: 3, beaconBrightness: 3.5, bloomStrength: 1.3 },
    body: null,
    binary: null,
    beacon: { radius: 7, angle: 0.9 },
    camera: { distance: 16, elevation: 0.22, azimuth: 1.1 },
    cinematic: false,
  },
  {
    id: 'wallpaper',
    name: 'Wallpaper (hides the UI)',
    description:
      'Clean cinematic frame: no bodies, rich deep sky, interface hidden. Press H to bring the controls back.',
    look: { discEnabled: true, discBrightness: 1.0, jetEnabled: false, gridEnabled: false, bloomStrength: 1.25, sky: { nebulaIntensity: 1.2, deepSkyIntensity: 1.2 } },
    body: null,
    binary: null,
    beacon: null,
    camera: { distance: 19, elevation: 0.16, azimuth: 1.2 },
    cinematic: true,
  },
];
