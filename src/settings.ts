/** UI-mutable settings: one plain object, read by sim and render each frame. */

import { BEACON_TUNING, BINARY_TUNING, BODY_TUNING, GRID_TUNING, SKY_TUNING } from './config';

export type QualityPreset = 'low' | 'medium' | 'high';

/** 'cinematic' = directable slow spiral; 'realistic' = one violent
 * parabolic pass with a bound/unbound debris split. */
export type TdeMode = 'cinematic' | 'realistic';

/**
 * Bake-time sky knobs. Changing any of these re-bakes the star cubemap, so
 * they are applied when a control settles rather than on every drag frame.
 */
export interface SkySettings {
  seed: number;
  starDensity: number;
  starBrightness: number;
  nebulaIntensity: number;
  deepSkyIntensity: number;
}

export interface Settings {
  paused: boolean;
  timeScale: number;
  discEnabled: boolean;
  discBrightness: number;
  jetEnabled: boolean;
  jetStrength: number;
  /** Super-Eddington outflow driven by the disc being fed. */
  windEnabled: boolean;
  windStrength: number;
  /** Flamm-paraboloid wireframe with the gravitational-wave ripple. */
  gridEnabled: boolean;
  gridOpacity: number;
  photonsEnabled: boolean;
  photonCount: number;
  photonSpreadDeg: number;
  bloomStrength: number;
  quality: QualityPreset;
  tdeMode: TdeMode;
  /** Wall-clock compression of the GW inspiral (trajectory shape is exact). */
  gwTimeCompression: number;
  /** Wall-clock compression of a disruption and its debris (same trick). */
  tdeTimeCompression: number;
  /** Wall-clock compression of the distant observer's clock for the beacon. */
  beaconTimeCompression: number;
  /** Exposure for the infalling probe; its true brightness spans six decades. */
  beaconBrightness: number;
  soundEnabled: boolean;
  volume: number;
  sky: SkySettings;
}

export function defaultSettings(): Settings {
  return {
    paused: false,
    timeScale: 1.0,
    discEnabled: true,
    discBrightness: 1.0,
    jetEnabled: false,
    jetStrength: 1.0,
    windEnabled: true,
    windStrength: 1.0,
    gridEnabled: false,
    gridOpacity: GRID_TUNING.opacity,
    photonsEnabled: false,
    photonCount: 8,
    photonSpreadDeg: 10,
    bloomStrength: 1.2,
    quality: 'medium',
    tdeMode: 'cinematic',
    gwTimeCompression: BINARY_TUNING.timeCompression,
    tdeTimeCompression: BODY_TUNING.timeCompression,
    beaconTimeCompression: BEACON_TUNING.timeCompression,
    beaconBrightness: 1.6,
    soundEnabled: false,
    volume: 0.6,
    sky: {
      seed: SKY_TUNING.seed,
      starDensity: SKY_TUNING.starDensity,
      starBrightness: SKY_TUNING.starBrightness,
      nebulaIntensity: SKY_TUNING.nebulaIntensity,
      deepSkyIntensity: SKY_TUNING.deepSkyIntensity,
    },
  };
}
