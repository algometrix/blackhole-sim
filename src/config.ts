/**
 * Every tunable "art direction" number in one place, in r_s = 1 units and
 * sim-seconds. Physics constants (horizon, ISCO, ...) live in
 * physics/constants.ts; these are the directable knobs layered on top.
 */

export const BODY_TUNING = {
  /** Velocity drag per second driving the slow inspiral. */
  drag: 0.015,
  /** Launch speed as a fraction of circular speed (sub-circular -> spiral). */
  launchSpeedFactor: 0.85,
  /** Radius where visible stretching begins. */
  rTidal: 6.0,
  /** Radius where mass shedding begins. */
  rShed: 4.5,
  /** Radius of final consumption. */
  rConsume: 1.2,
  /** Mass fraction below which the body counts as consumed. */
  massConsumed: 0.05,
  /** Maximum axial stretch factor. */
  stretchMax: 6.0,
  /** stretchTarget(r) = clamp((rTidal / r)^exponent, 1, stretchMax). */
  stretchExponent: 1.8,
  /** Smoothing time constant for the stretch animation, seconds. */
  stretchSmoothTime: 0.8,
  /** Base fractional mass-loss rate per second while shedding. */
  massLossBase: 0.08,
  planetRadius: 0.3,
  starRadius: 0.6,
};

export const DEBRIS_TUNING = {
  maxParticles: 16384,
  /** Spawn rates in particles per second at full body mass. */
  spawnRatePlanet: 400,
  spawnRateStar: 1200,
  /** Particles emitted in the final consumption burst. */
  burstCount: 200,
  /** Position jitter sigma as a fraction of body radius. */
  spawnJitter: 0.3,
  /** Radial kick toward the hole as a fraction of local circular speed. */
  spawnKick: 0.2,
  /** Tangential inspiral drag per second. */
  drag: 0.05,
  /** Disc-plane settling spring (s^-2) and damping (s^-1). */
  planeSpring: 0.8,
  planeDamping: 1.2,
  /** Radius where particles start being absorbed into the disc (ISCO). */
  absorbRadius: 3.0,
  /** Seconds over which an absorbed particle fades out. */
  absorbFadeTime: 1.5,
  /** Hard-kill radius just outside the horizon. */
  killRadius: 1.05,
  /** Hard-kill age, seconds. */
  maxAge: 30,
  /** Heat ramp: heat = clamp01((heatOuterR - r) / (heatOuterR - heatInnerR)). */
  heatOuterR: 8.0,
  heatInnerR: 2.0,
  /** Star debris glows hotter and brighter than rocky debris. */
  starHeatFloor: 0.4,
  starBrightness: 1.6,
  planetBrightness: 1.0,
  pointSize: 0.04,
};

export const DISC_TUNING = {
  /** Disc boost decay time constant, seconds. */
  boostDecayTau: 6.0,
  boostMax: 2.0,
  /** A fully absorbed body credits about this much total boost. */
  boostPerBody: 1.0,
};

export const PLACEMENT_TUNING = {
  rMin: 7.0,
  rMax: 20.0,
  /** Secondary black hole may start closer in. */
  bh2RMin: 4.0,
};

export const BINARY_TUNING = {
  /** Secondary/primary mass ratio (GW150914-ish is ~0.8; 0.3 reads better). */
  massRatio: 0.3,
  /**
   * The Peters-equation inspiral is exact in geometric time, but geometric
   * time from ~8 r_s to merger is ~1600 time units — unwatchable at 1:1.
   * The trajectory SHAPE (orbits vs separation, chirp profile) is untouched;
   * only the clock is compressed by this factor. UI-tunable.
   */
  timeCompression: 40,
  /** Orbit tilt out of the disc plane, radians (~30 deg): the secondary dips
   * through the disc twice per orbit instead of plowing along inside it. */
  inclination: 0.52,
  /**
   * Fraction of total mass radiated as gravitational waves at merger, scaled
   * by the symmetric mass ratio (GW150914 radiated ~4.6% at eta = 0.25).
   */
  radiatedFractionAtEqualMass: 0.048,
  /** Ringdown wobble (art-directed breathing of the shadow, not a real QNM). */
  ringdownAmplitude: 0.06,
  ringdownOmega: 8.0,
  ringdownTau: 0.6,
};

export const TDE_TUNING = {
  /** Tidal radii for realistic mode, r_s units (mass-ratio story: a star is
   * fluffier than a rocky planet, so it shreds farther out). */
  starTidalRadius: 4.0,
  planetTidalRadius: 2.5,
  /** Pericenter as a fraction of the tidal radius (deep enough to fully shred). */
  pericenterFraction: 0.7,
  /** Fractional mass-loss rate per second near pericenter (violent, one pass). */
  massLossBase: 0.9,
  /** Debris energy spread as a fraction of local circular speed — sets the
   * bound/unbound split (real TDEs eject roughly half the star). */
  energySpread: 0.35,
  /** Bound-debris drag so returning streams eventually feed the disc. */
  boundDrag: 0.02,
  /** A remnant that makes it back out past this radius has escaped. */
  escapeRadius: 30,
};

export const CAMERA_TUNING = {
  minDistance: 3.0,
  maxDistance: 60.0,
  initialDistance: 22.0,
  /** Initial polar angle above the disc plane, radians. */
  initialElevation: 0.18,
};
