/**
 * Every tunable "art direction" number in one place, in r_s = 1 units and
 * sim-seconds. Physics constants (horizon, ISCO, ...) live in
 * physics/constants.ts; these are the directable knobs layered on top.
 *
 * Three clocks tick in this file. BODY_TUNING and DEBRIS_TUNING run on the
 * compressed *disruption clock* (see BODY_TUNING.timeCompression), so a rate
 * of "per second" there is per disruption-second, roughly eight times faster
 * than the wall clock at the shipped default. BINARY_TUNING runs on the
 * *inspiral clock*, and BEACON_TUNING on the *beacon clock*, which is
 * deliberately the slowest of the three. Everything else (the disc, the
 * camera, the audio) runs on the plain simulation clock.
 */

export const BODY_TUNING = {
  /**
   * Wall-clock compression of the disruption, exactly the trick the binary
   * inspiral uses: the trajectories are untouched, the clock is not. A
   * circular orbit at 12 r_s takes ~370 time units, so at 1:1 the debris
   * never finishes a lap and the stream never reads as a spiral.
   */
  timeCompression: 8,
  /** Velocity drag per second driving the slow inspiral. */
  drag: 0.015,
  /** Launch speed as a fraction of circular speed (sub-circular -> spiral). */
  launchSpeedFactor: 0.85,
  /** Radius where visible stretching begins. */
  rTidal: 11.0,
  /** Radius where mass shedding begins, outside the disc's outer edge, so
   *  the stream is drawn against the sky instead of inside the glare. */
  rShed: 7.0,
  /** Radius of final consumption. */
  rConsume: 1.2,
  /** Mass fraction below which the body counts as consumed. */
  massConsumed: 0.05,
  /**
   * Maximum axial stretch factor. Spaghettification is the headline of a
   * disruption, so the body draws out into a genuine strand rather than the
   * mild ellipsoid a conservative number gives.
   */
  stretchMax: 8.0,
  /** stretchTarget(r) = clamp((rTidal / r)^exponent, 1, stretchMax). */
  stretchExponent: 2.0,
  /** Smoothing time constant for the stretch animation, seconds. */
  stretchSmoothTime: 0.8,
  /** Base fractional mass-loss rate per second while shedding. */
  massLossBase: 0.08,
  /**
   * Mass a body spills per second while it is merely stretching, at the moment
   * it reaches the shedding radius (it ramps up from zero at the tidal
   * radius). Small on purpose: this is the thin stream that connects a
   * still-intact body to the hole, not the disruption itself.
   */
  stretchSpillRate: 0.012,
  planetRadius: 0.3,
  starRadius: 0.6,
};

export const DEBRIS_TUNING = {
  /**
   * The stream has to read as a continuous glowing ribbon, not a dotted line,
   * so the pool is large and the sprites overlap. 48k additive points is a
   * few ms on the GPU and nothing on the CPU (the sim is pure array math).
   */
  maxParticles: 48000,
  /** Spawn rates in particles per second of disruption time at full mass. */
  spawnRatePlanet: 700,
  spawnRateStar: 1600,
  /** Particles emitted in the final consumption burst. */
  burstCount: 900,
  /** Lateral jitter sigma as a fraction of the strand's (thin) radius. */
  spawnJitter: 0.45,
  /** Radial kick toward the hole as a fraction of local circular speed. */
  spawnKick: 0.2,
  /**
   * Tangential inspiral drag per second. Very low on purpose: it acts for
   * hundreds of disruption-seconds, so 0.012 strips 97% of a particle's
   * velocity over one stream lifetime and drops the whole ribbon down the
   * hole. At 0.003 the debris circularizes over a few laps, which is what
   * turns a trail of particles into the wound ribbon a disruption makes.
   */
  drag: 0.003,
  /** Disc-plane settling spring (s^-2) and damping (s^-1). */
  planeSpring: 0.5,
  planeDamping: 1.0,
  /** Radius where particles start being absorbed into the disc (ISCO). */
  absorbRadius: 3.0,
  /**
   * How circular a particle's orbit must be before the disc takes it: inside
   * the ISCO its speed-squared must fall below this multiple of the local
   * circular value. Raise it and eccentric material is eaten on its first
   * pericenter pass, taking the wrapping ribbon with it.
   */
  circularizedSpeedFactor: 1.3,
  /** Seconds over which an absorbed particle fades out. */
  absorbFadeTime: 1.5,
  /** Hard-kill radius just outside the horizon. */
  killRadius: 1.05,
  /**
   * Hard-kill age in disruption-clock seconds. An orbit at 8 r_s takes ~200 of
   * them, so this is four or five laps, and those laps are the stream.
   */
  maxAge: 900,
  /**
   * Heat ramp: heat = clamp01((heatOuterR - r) / (heatOuterR - heatInnerR)).
   * The outer edge sits beyond the stream's apocentre so the far end of the
   * ribbon stays deep crimson and only the material falling past the inner
   * edge goes white, the colour gradient every disruption image shows.
   */
  heatOuterR: 14.0,
  heatInnerR: 2.0,
  /** Star debris glows hotter and brighter than rocky debris. */
  starHeatFloor: 0.4,
  starBrightness: 1.2,
  planetBrightness: 0.85,
  /**
   * Sprite radius in world units. Screen size is this times ~600 / distance,
   * so the old 0.075 drew a sub-2-pixel dot at a normal viewing distance and
   * the stream read as grit rather than gas. At 0.3 the sprites overlap into
   * a continuous ribbon, which is what the brightness above is trimmed for.
   */
  pointSize: 0.3,
};

export const DISC_TUNING = {
  /** Disc boost decay time constant, in wall-clock seconds: the flare is a
   *  visual afterglow, so it fades at a rate the eye reads, not at the
   *  disruption clock's rate. */
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
   * time from ~8 r_s to merger is ~1600 time units, unwatchable at 1:1.
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
  /**
   * Radius at which a body comes apart in realistic mode, r_s units. A star is
   * fluffier than a rocky planet, so it shreds farther out. Both sit outside the disc's outer edge
   * on purpose: r_T / r_s grows as M^(-2/3), so for a supermassive hole the
   * disruption really does happen well outside the ISCO, and a stream torn
   * apart inside the disc is invisible against its glare.
   */
  starShedRadius: 9.0,
  planetShedRadius: 5.5,
  /** Stretching starts this much further out than shedding does. */
  stretchRadiusFactor: 1.5,
  /** Pericenter as a fraction of the shed radius (deep enough to fully shred). */
  pericenterFraction: 0.7,
  /** Fractional mass-loss rate per second near pericenter (violent, one pass). */
  massLossBase: 0.9,
  /** Debris energy spread as a fraction of local circular speed, sets the
   * bound/unbound split (real TDEs eject roughly half the star). */
  energySpread: 0.35,
  /** A remnant that makes it back out past this radius has escaped. */
  escapeRadius: 30,
};

export const BEACON_TUNING = {
  /**
   * Release radius floor for a click. Closer in than this and the probe is
   * already inside the disc when it is let go, so the interesting part of the
   * fall happens behind the glare.
   */
  rMin: 4.0,
  /**
   * Tilt of the drop line out of the disc plane, radians (~35 deg). A probe
   * released inside the plane spends the fall behind the disc's inner glare;
   * one released near the pole falls down the jet and through the wind cone,
   * which opens to about 44 deg from the axis. This threads between them.
   */
  inclination: 0.61,
  /**
   * Drawn radius, r_s units. Art-directed: a real probe is a point and a point
   * is a fraction of a pixel, so the sprite also carries a screen-space floor
   * (see render/beaconPoint.ts). It is a legibility choice, not a size.
   */
  radius: 0.06,
  /**
   * Wall-clock compression of the distant observer's clock for the probe. The
   * same trick the other two clocks use, and for the same reason: scaling the
   * clock uniformly speeds up the fall and the exponential stall together, so
   * the shape of the freeze is untouched. Slower than the disruption clock on
   * purpose, because here the observer's clock is the quantity on show.
   */
  timeCompression: 3,
  /** Emission scale, matched against the disc's own factor of 16. */
  emission: 22.0,
  /**
   * Gap (r_s units) below which the image counts as frozen. Past this the
   * probe moves by less than a thousandth of an r_s while its brightness has
   * already fallen by nine decades, so nothing more is going to happen.
   */
  settledGap: 1e-3,
};

export const GRID_TUNING = {
  /** Wireframe extent, r_s units. The rings crowd toward the throat. */
  innerRadius: 1.6,
  outerRadius: 42,
  ringCount: 34,
  spokeCount: 72,
  ringSegments: 160,
  /** Vertical exaggeration of Flamm's funnel (1.0 draws the true embedding). */
  depthScale: 0.55,
  color: 0x35d6f0,
  opacity: 0.4,
  /** Strain scale: the ripple height is this times (contact separation / a). */
  waveAmplitude: 24,
  /**
   * Wave speed for the retarded phase. The spiral pattern and its 1/r decay
   * are the real quadrupole solution; only this speed is art-directed, since
   * light-speed propagation under the compressed inspiral clock would put the
   * crests far below one grid cell.
   */
  waveSpeed: 6,
  /** Cap the wavenumber so the crests never alias against the ring spacing. */
  maxWavenumber: 1.0,
  /** Seconds over which the burst fades once nothing is orbiting. */
  waveDecayTau: 1.4,
};

export const SKY_TUNING = {
  /**
   * Cubemap face resolution. The sky is baked once at boot and again whenever
   * a sky control settles, so this trades boot time for star crispness.
   */
  faceSize: 1024,
  seed: 3.7,
  /** Scales how many cells of each star grid hold a star. */
  starDensity: 1.0,
  starBrightness: 1.0,
  /** Galactic band glow, dust extinction, emission nebulae and the hue wash. */
  nebulaIntensity: 1.0,
  /** Globular clusters and distant galaxies. */
  deepSkyIntensity: 1.0,
};

export const CAMERA_TUNING = {
  minDistance: 3.0,
  maxDistance: 60.0,
  initialDistance: 22.0,
  /** Initial polar angle above the disc plane, radians. */
  initialElevation: 0.18,
};
