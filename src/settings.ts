/** UI-mutable settings: one plain object, read by sim and render each frame. */

export type QualityPreset = 'low' | 'medium' | 'high';

/** 'cinematic' = directable slow spiral; 'realistic' = one violent
 * parabolic pass with a bound/unbound debris split. */
export type TdeMode = 'cinematic' | 'realistic';

export interface Settings {
  paused: boolean;
  timeScale: number;
  discEnabled: boolean;
  discBrightness: number;
  photonsEnabled: boolean;
  photonCount: number;
  photonSpreadDeg: number;
  bloomStrength: number;
  quality: QualityPreset;
  tdeMode: TdeMode;
  /** Wall-clock compression of the GW inspiral (trajectory shape is exact). */
  gwTimeCompression: number;
  soundEnabled: boolean;
  volume: number;
}

export function defaultSettings(): Settings {
  return {
    paused: false,
    timeScale: 1.0,
    discEnabled: true,
    discBrightness: 1.0,
    photonsEnabled: false,
    photonCount: 8,
    photonSpreadDeg: 10,
    bloomStrength: 1.2,
    quality: 'medium',
    tdeMode: 'cinematic',
    gwTimeCompression: 40,
    soundEnabled: false,
    volume: 0.6,
  };
}
