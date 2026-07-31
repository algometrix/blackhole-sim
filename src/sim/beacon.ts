/**
 * The infalling beacon: a probe released from rest on a radial line and left
 * to fall. Everything in this module is what a **distant observer** measures.
 *
 * That distinction is the feature. To us the probe reddens, dims and stalls
 * just outside the horizon, and it never finishes falling: the coordinate time
 * to reach r_s diverges logarithmically, so the gap decays exponentially and
 * the image freezes. That is a statement about our clock and our light, not
 * about the probe. On its own clock the probe crosses in finite time (about 28
 * r_s/c from a release at 7 r_s), notices nothing in particular as it does,
 * and keeps going. `properTimeAtHorizon` is that finite number, and the
 * readout shows it beside the diverging coordinate time so the two clocks sit
 * side by side.
 *
 * This is the one moving object in the app on exact Schwarzschild motion
 * rather than the Paczynski-Wiita potential the bodies and debris use. PW is a
 * Newtonian stand-in that gets the ISCO right and has no coordinate-time
 * divergence at all: PW matter crosses r_s in finite time. Reusing
 * `sim/gravity.ts` here would make the one effect this module exists to show
 * impossible, so the radial geodesic is integrated directly.
 *
 * The integrated state is the horizon gap r - r_s, never r. Near the horizon
 * the gap decays exponentially; a float64 holding r runs out of significant
 * digits at gap ~ 1e-16 and snaps the probe onto the horizon it never reaches.
 * With the gap as the variable the freeze stays physics down to 1e-300 rather
 * than becoming a rounding artifact.
 *
 * Geometric units throughout: c = 1, lengths in r_s, coordinate and proper
 * times in r_s/c.
 */
import { Vector3 } from 'three';
import { BEACON_TUNING } from '../config';
import { B_CRIT, R_PHOTON } from '../physics/constants';
import { clampPlacement } from './placement';
import type { Beacon } from './types';

/**
 * Ceiling on one integration step, r_s/c. The exponential tail *is* the
 * feature, and its rate is what a coarse step biases: near the horizon
 * dgap/dt = -gap/r_s, and an explicit step of size h reproduces that decay
 * with a relative rate error of order h. At 0.05 the freeze happens within a
 * couple of percent of the analytic time constant at any compression setting.
 */
export const BEACON_MAX_STEP = 0.05;

/**
 * Ceiling on the substep count, so the fastest clock setting cannot turn one
 * tick into an unbounded loop. At the panel's maximum compression of 20 a
 * 1/60 s tick asks for 7 substeps, so this never binds in practice.
 */
export const MAX_BEACON_SUBSTEPS = 24;

/**
 * Hardest a single step is allowed to shrink the gap. The physics forbids the
 * probe reaching r_s in finite coordinate time, so no step may place it there;
 * this guard makes that impossible for any dt, however pathological. It is a
 * numerical floor, not a physical one, and at the shipped step size it never
 * engages (a step of 0.05 removes about 5% of the gap, not 99.9%).
 */
export const GAP_FLOOR_FRACTION = 1e-3;

/**
 * Conserved energy per unit mass of a probe released from rest at r0:
 * E = sqrt(1 - r_s/r0). It is 1 for a release from infinity and 0 at the
 * horizon, and it sets every other quantity here.
 */
export function infallEnergy(r0: number, rs: number): number {
  return Math.sqrt(Math.max(1 - rs / r0, 0));
}

/**
 * The metric factor f = 1 - r_s/r, computed from the gap as gap / (r_s + gap).
 * Algebraically identical, but it never subtracts two nearly equal numbers, so
 * it keeps full precision all the way down to the horizon.
 */
export function metricFactor(gap: number, rs: number): number {
  return gap / (rs + gap);
}

/**
 * The probe's radial speed on its own clock, |dr/dtau| = sqrt(E^2 - f).
 *
 * Evaluated as r_s (fallen distance) / (r r0), which is the same number: E^2
 * and f agree to fifteen digits at the moment of release, so subtracting them
 * reports a probe already moving at 1e-8 c before it has been let go, and the
 * error propagates straight into the redshift.
 */
export function properInfallSpeed(gap: number, r0: number, rs: number): number {
  const fallen = r0 - rs - gap;
  return Math.sqrt(Math.max((rs * fallen) / ((rs + gap) * r0), 0));
}

/**
 * Infall speed a *static observer sitting at r* measures, in units of c. Zero
 * at release, and it tends to 1 at the horizon: locally the probe really does
 * arrive at light speed, which is why the recession Doppler below eventually
 * dominates the reddening.
 */
export function localInfallSpeed(gap: number, r0: number, rs: number): number {
  const energy = infallEnergy(r0, rs);
  if (energy <= 0) return 0;
  return properInfallSpeed(gap, r0, rs) / energy;
}

/**
 * Growth of that local speed per unit coordinate time. Written out separately
 * because it is finite and positive at the release radius, where the speed
 * itself is exactly zero: that is what gets the fall started (see
 * `advanceHorizonGap`).
 */
export function localSpeedGrowth(gap: number, r0: number, rs: number): number {
  const energy = infallEnergy(r0, rs);
  if (energy <= 0) return 0;
  const r = rs + gap;
  return (rs * metricFactor(gap, rs)) / (2 * energy * energy * r * r);
}

/**
 * The gravitational part of the redshift, sqrt(1 - r_s/r): what a *static*
 * emitter at r would show us. This is the textbook factor, and it is the whole
 * answer only while the probe is still at rest at its release radius.
 */
export function gravitationalRedshift(gap: number, rs: number): number {
  return Math.sqrt(metricFactor(gap, rs));
}

/**
 * Relativistic Doppler factor for a source receding at `speed` (units of c)
 * from the observer it is emitting toward: sqrt(1 - v^2) / (1 + v). The probe
 * is falling away from us, so this reddens it further on top of gravity.
 *
 * This is the reference statement of that half of the reddening rather than
 * the code path the app runs: `observedRedshift` evaluates an algebraically
 * identical form that survives near the horizon, and a test holds the two
 * together.
 */
export function recessionDoppler(speed: number): number {
  const v = Math.min(Math.max(speed, 0), 1);
  return Math.sqrt(Math.max(1 - v * v, 0)) / (1 + v);
}

/**
 * Received / emitted frequency for the falling probe, seen from far away.
 *
 * The honest infaller value, not the static one: the probe is both deep in the
 * well and receding fast, so the two effects multiply, and this is exactly
 *
 *     gravitationalRedshift(gap) * recessionDoppler(localInfallSpeed(gap))
 *
 * which a test asserts to twelve digits. It is deliberately not *evaluated*
 * that way. The probe's local speed reaches 1.0 in float64 at a gap of about
 * 1e-17, at which point sqrt(1 - v^2) is exactly zero and the product collapses
 * to zero with it, taking the last decade of the fade with it. The algebraically
 * identical f / (E + sqrt(E^2 - f)) never subtracts near-equal numbers and stays
 * accurate past a gap of 1e-300, which is where the freeze has to live.
 *
 * Near the horizon it is linear in the gap, g -> gap / (2 E r_s), which is why
 * the probe fades so much faster than it slows: brightness goes as g^3.
 */
export function observedRedshift(gap: number, r0: number, rs: number): number {
  const energy = infallEnergy(r0, rs);
  if (energy <= 0) return 0;
  return metricFactor(gap, rs) / (energy + properInfallSpeed(gap, r0, rs));
}

/**
 * dr/dt in Schwarzschild coordinate time (negative, r_s per r_s/c):
 * -f * v_local. Near the horizon f -> gap / r_s and v_local -> 1, so
 * dgap/dt -> -gap / r_s and the gap decays as exp(-t / r_s). That exponential
 * is the freeze, and it falls out of the geodesic rather than being imposed.
 */
export function coordinateInfallRate(gap: number, r0: number, rs: number): number {
  return -metricFactor(gap, rs) * localInfallSpeed(gap, r0, rs);
}

/**
 * One midpoint step of the coordinate-time fall.
 *
 * The local speed is advanced to the midpoint alongside the radius, rather
 * than being re-derived from the midpoint radius, and that is not a
 * refinement: at the release radius the rate is exactly zero and the ODE is
 * square-root singular there (the drop grows as t^2, so dr/dt goes as
 * sqrt(drop)). A scheme that only ever samples dr/dt therefore parks the probe
 * at r0 forever. The speed leaves zero at a finite rate, and stepping it too
 * reproduces the analytic short-time law drop = E^2 r_s t^2 / (4 r0^2)
 * exactly on the first step.
 */
export function advanceHorizonGap(gap: number, dt: number, r0: number, rs: number): number {
  const energy = infallEnergy(r0, rs);
  const floor = gap * GAP_FLOOR_FRACTION;
  if (energy <= 0) return gap;

  const rate = coordinateInfallRate(gap, r0, rs);
  const gapMid = Math.max(gap + 0.5 * dt * rate, floor);
  const speedMid = localInfallSpeed(gap, r0, rs) + 0.5 * dt * localSpeedGrowth(gap, r0, rs);
  const midRate = -metricFactor(gapMid, rs) * Math.min(speedMid, 1);
  return Math.max(gap + dt * midRate, floor);
}

/**
 * The probe's own elapsed time since release, by the exact cycloid solution
 *
 *     tau = (1/2) sqrt(r0^3 / r_s) (eta + sin eta),   cos eta = 2r/r0 - 1
 *
 * Closed form on purpose: this is the honesty counterweight to the freeze, so
 * it is evaluated fresh from the current radius rather than accumulated, and
 * cannot drift away from the coordinate-time integration beside it.
 *
 * dtau/dr is finite at the horizon (it tends to -1/E), so once the gap is
 * below about 1e-16 the answer equals `properTimeAtHorizon` to every digit a
 * float64 has. The readout then shows the probe's clock pinned at the crossing
 * value while ours keeps counting, which is the correct reading of it: on its
 * own clock the crossing is over, to a precision no display has.
 */
export function properTimeSinceRelease(r: number, r0: number, rs: number): number {
  const eta = Math.acos(Math.min(Math.max((2 * r) / r0 - 1, -1), 1));
  return 0.5 * Math.sqrt((r0 * r0 * r0) / rs) * (eta + Math.sin(eta));
}

/**
 * The probe's own time at the horizon crossing. Finite, always: it crosses,
 * we simply never see it happen.
 */
export function properTimeAtHorizon(r0: number, rs: number): number {
  return properTimeSinceRelease(rs, r0, rs);
}

/**
 * Apparent radius of the probe's image, in impact-parameter units, for a
 * distant observer.
 *
 * A photon leaving radius r perpendicular to the radial direction escapes with
 * impact parameter b = r / sqrt(1 - r_s/r), and that expression bottoms out at
 * exactly b_crit = 3 sqrt(3) M at the photon sphere. Inside the photon sphere
 * the tangential ray is captured and the escaping cone closes onto the radial
 * direction, so no image can appear inside the shadow: it piles up on the
 * photon ring instead, which is why a probe near the horizon is seen hugging
 * the rim rather than sinking through it.
 *
 * Honest note: this is exact for the ray at its turning point, and the app
 * applies it in every viewing geometry as a first-order stand-in. The true
 * image position needs the deflection integral solved for the observer's
 * actual direction, which the raymarch pass does for the disc and the star but
 * which the overlay pass this probe is drawn in cannot.
 */
export function apparentImageRadius(r: number, rs: number): number {
  if (r <= R_PHOTON * rs) return B_CRIT * rs;
  return r / Math.sqrt(1 - rs / r);
}

/**
 * Where a click on the disc plane releases the probe: same azimuth, same
 * radius, lifted out of the plane by `BEACON_TUNING.inclination`.
 *
 * The lift is why the drop is watchable. Released inside the disc plane the
 * probe spends the whole fall behind the inner glare, and released near the
 * pole it falls down the jet and through the wind cone.
 */
export function releasePoint(clicked: Vector3): Vector3 {
  const flat = clampPlacement(clicked, BEACON_TUNING.rMin);
  const radius = flat.length();
  const incl = BEACON_TUNING.inclination;
  return new Vector3(
    flat.x * Math.cos(incl),
    radius * Math.sin(incl),
    flat.z * Math.cos(incl),
  );
}

/** Everything a distant observer can say about the probe right now. */
export interface BeaconObservables {
  /** r - r_s, r_s units. It approaches zero and never reaches it. */
  horizonGap: number;
  /** Received / emitted frequency. Drives both the colour and the brightness. */
  redshift: number;
  /** Radius the image is drawn at, floored at the photon ring. */
  apparentRadius: number;
  /** Our clock since release, r_s/c. Diverges. */
  coordinateTime: number;
  /** The probe's clock since release, r_s/c. */
  probeProperTime: number;
  /** The probe's clock at the crossing, r_s/c. Finite. */
  probeProperTimeAtHorizon: number;
  /** The image has stopped changing perceptibly: the freeze has set in. */
  settled: boolean;
}

export function observeBeacon(beacon: Beacon): BeaconObservables {
  const { horizonGap, r0, horizonRs } = beacon;
  const r = horizonRs + horizonGap;
  return {
    horizonGap,
    redshift: observedRedshift(horizonGap, r0, horizonRs),
    apparentRadius: apparentImageRadius(r, horizonRs),
    coordinateTime: beacon.coordinateTime,
    probeProperTime: properTimeSinceRelease(r, r0, horizonRs),
    probeProperTimeAtHorizon: properTimeAtHorizon(r0, horizonRs),
    settled: horizonGap < BEACON_TUNING.settledGap * horizonRs,
  };
}

/**
 * Advance the probe by `dt` of the distant observer's time.
 *
 * There is no result to return, and that is the point: nothing ever happens to
 * this object. It is never swallowed, never consumed, never removed. Only
 * `clearBeacon` takes it out of the scene.
 *
 * `rs` is not a parameter. The whole solution is anchored to the r_s the probe
 * was released against, and letting a caller step it against a different one
 * would silently produce a trajectory that is not a geodesic of any spacetime.
 * world.ts drops the beacon instead when a merger moves the horizon.
 */
export function stepBeacon(beacon: Beacon, dt: number): void {
  const substeps = Math.min(Math.max(1, Math.ceil(dt / BEACON_MAX_STEP)), MAX_BEACON_SUBSTEPS);
  const subDt = dt / substeps;
  for (let step = 0; step < substeps; step++) {
    beacon.horizonGap = advanceHorizonGap(beacon.horizonGap, subDt, beacon.r0, beacon.horizonRs);
  }
  beacon.coordinateTime += dt;
  beacon.pos.copy(beacon.direction).multiplyScalar(beacon.horizonRs + beacon.horizonGap);
}
