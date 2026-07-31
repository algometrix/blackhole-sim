/**
 * The tidal-disruption light curve: a fixed-capacity recording of how hard the
 * disruption is feeding the disc, plus the log-log projection maths the chart
 * draws with. Pure CPU state and arithmetic, no DOM and no WebGL, so every
 * function here is unit tested directly.
 *
 * ## Where t^(-5/3) comes from
 *
 * When a star is torn apart the debris leaves with a spread of orbital
 * energies (Part 11 of docs/THEORY.md). Take that spread to be flat across the
 * star, so equal masses of debris occupy equal slices of binding energy:
 *
 *     dM/d|eps| = const
 *
 * A bound fragment with binding energy |eps| is on a Kepler ellipse of
 * semi-major axis a = GM / (2|eps|), and Kepler's third law gives its return
 * period:
 *
 *     T = 2*pi * sqrt(a^3 / GM) = 2*pi * GM * (2|eps|)^(-3/2)
 *
 * Invert that to ask which fragments are arriving at time t:
 *
 *     |eps|(t) = (1/2) * (2*pi*GM / t)^(2/3)
 *
 * The fallback rate is then the chain rule, and the constant energy density
 * drops straight out of the front:
 *
 *     dM/dt = (dM/d|eps|) * |d|eps|/dt| = (dM/d|eps|) * (1/3) * (2*pi*GM)^(2/3) * t^(-5/3)
 *
 * so dM/dt ~ t^(-5/3) (Rees, 1988). Only the exponent survives the algebra,
 * which is why it is the signature real surveys hunt for, and why FALLBACK_INDEX
 * below is an exact rational and not a tuned number.
 *
 * ## The app does not reproduce this law, and the chart says so
 *
 * This was measured, not assumed (src/ui/__tests__/fallbackLaw.test.ts). A
 * realistic-mode star disruption at the shipped clock records a decay of about
 * t^(-7.3), four times steeper than the law, and the fitted index moves with
 * the Disruption speed slider (about -12.5 at compression 4, -3.3 at 30) while
 * being all but independent of the seed and the placement radius. That is the
 * signature of the app's own machinery, not of the debris:
 *
 * - `world.discBoost` is not the fallback rate. It is the absorbed-particle
 *   rate convolved with the exponential feeding kernel in sim/disc.ts, whose
 *   width on this chart's axis is DISC_TUNING.boostDecayTau multiplied by
 *   settings.tdeTimeCompression. Once the last particle is absorbed the curve
 *   is that kernel and nothing else, and an exponential in log-log steepens
 *   without bound. Hence the slider dependence.
 * - The debris is not left to return on its own orbits either. DEBRIS_TUNING
 *   drag circularizes it on a fixed timescale, so the bound half is absorbed
 *   within roughly one factor of two in time instead of spreading over the
 *   decades a real energy distribution would, and DEBRIS_TUNING.maxAge kills
 *   the longest-period material, which is exactly what would have made the
 *   late-time tail.
 * - Cinematic mode fits close to -1.85 at the shipped clock. That is a
 *   coincidence of kernel width, not agreement: the cinematic spiral is a drag
 *   inspiral with no energy spread at all, and its fitted index moves with the
 *   same slider.
 *
 * So the reference line is drawn anchored at the recorded peak and never fitted
 * to the data, and the caption prints the fitted index next to the law's. The
 * honest claim for this overlay is "here is what the simulation's feeding
 * actually does, next to what nature does", not "the law emerges".
 */

import { LIGHT_CURVE_TUNING } from '../config';
import type { TdeMode } from '../settings';

/** dM/dt ~ t^(-5/3): the fallback exponent derived in the header. */
export const FALLBACK_INDEX = -5 / 3;

/**
 * A recording of one disruption. Times are in disruption-clock seconds since
 * the star came apart (see BODY_TUNING.timeCompression), so the time axis is
 * unaffected by the Disruption speed slider and by the simulation speed, and
 * freezes when the simulation is paused. The recorded brightness still moves
 * with the compression, which is why it is stored: see the header.
 */
export interface FlareCurve {
  /** Sample times, strictly increasing, in disruption-clock seconds. */
  readonly time: Float32Array;
  /** Disc feeding boost at each sample time. */
  readonly boost: Float32Array;
  count: number;
  readonly capacity: number;
  /** Shipped sampling period, restored by resetFlare after a decimation. */
  readonly baseInterval: number;
  /** Current sampling period; doubles every time the record is decimated. */
  interval: number;
  /** Disruption-clock seconds since the flare started. */
  elapsed: number;
  lastSampleAt: number;
  recording: boolean;
  /** Disruption mode this flare was recorded in, for the chart's readout. */
  mode: TdeMode | null;
  /** Clock compression at the moment of disruption, also for the readout. */
  timeCompression: number;
}

export interface FlarePeak {
  index: number;
  time: number;
  boost: number;
}

/** Log-log bounds of a plot, all four strictly positive. */
export interface LogAxes {
  tMin: number;
  tMax: number;
  boostMin: number;
  boostMax: number;
}

/** Pixel rectangle the curve is drawn into, y measured downward. */
export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlotPoint {
  x: number;
  y: number;
}

export interface FlareCurveOptions {
  capacity?: number;
  sampleInterval?: number;
}

export function createFlareCurve({
  capacity = LIGHT_CURVE_TUNING.maxSamples,
  sampleInterval = LIGHT_CURVE_TUNING.sampleInterval,
}: FlareCurveOptions = {}): FlareCurve {
  return {
    time: new Float32Array(capacity),
    boost: new Float32Array(capacity),
    count: 0,
    capacity,
    baseInterval: sampleInterval,
    interval: sampleInterval,
    elapsed: 0,
    lastSampleAt: 0,
    recording: false,
    mode: null,
    timeCompression: 0,
  };
}

/**
 * Forget the recording and stop sampling. The sample arrays keep their stale
 * contents on purpose: `count` is the only thing that says what is real, and
 * zeroing 4 KB would buy nothing.
 */
export function resetFlare(curve: FlareCurve): void {
  curve.count = 0;
  curve.interval = curve.baseInterval;
  curve.elapsed = 0;
  curve.lastSampleAt = 0;
  curve.recording = false;
  curve.mode = null;
  curve.timeCompression = 0;
}

export interface FlareStart {
  mode: TdeMode;
  /** settings.tdeTimeCompression when the star came apart. */
  timeCompression: number;
}

/** Start the clock at the moment the star comes apart (WorldEvents.shredNow). */
export function startFlare(curve: FlareCurve, { mode, timeCompression }: FlareStart): void {
  resetFlare(curve);
  curve.recording = true;
  curve.mode = mode;
  curve.timeCompression = timeCompression;
}

export interface FeedingSample {
  /** Disruption-clock seconds advanced by this tick. */
  disruptionDt: number;
  /** world.discBoost after the tick. */
  boost: number;
}

/**
 * Advance the disruption clock and, at most once per sampling interval, store
 * the current feeding boost. Called from the fixed-step loop, so it stays an
 * add, a compare and two typed-array writes.
 */
export function recordFeeding(curve: FlareCurve, { disruptionDt, boost }: FeedingSample): void {
  if (!curve.recording) return;
  curve.elapsed += disruptionDt;
  if (curve.elapsed - curve.lastSampleAt < curve.interval) return;

  // Stop once the flare is over. Left running, the ring fills with post-flare
  // zeros and then decimates the real curve to make room for them, so the
  // longer you leave the scene alone the coarser the record of the event gets.
  if (curve.count > 0 && hasFaded(curve, boost)) {
    curve.recording = false;
    return;
  }

  if (curve.count === curve.capacity) halveResolution(curve);
  curve.time[curve.count] = curve.elapsed;
  curve.boost[curve.count] = boost;
  curve.count += 1;
  curve.lastSampleAt = curve.elapsed;
}

/**
 * True once the boost has sat far below its own peak for long enough that
 * nothing is coming back. The threshold is a fraction of the peak rather than
 * an absolute number, because the peak height depends on the body and the mode.
 */
function hasFaded(curve: FlareCurve, boost: number): boolean {
  let peak = 0;
  for (let i = 0; i < curve.count; i++) peak = Math.max(peak, curve.boost[i]!);
  if (peak <= 0) return false;
  return boost < LIGHT_CURVE_TUNING.fadedFraction * peak;
}

/**
 * Throw away every other sample and double the sampling period, so a flare
 * that outlives the buffer degrades in resolution instead of in span. The
 * newest sample is written over the last kept slot when the count is even,
 * because losing the leading edge of the curve would make the chart lag the
 * scene by up to one interval.
 */
export function halveResolution(curve: FlareCurve): void {
  const kept = Math.ceil(curve.count / 2);
  for (let i = 0; i < kept; i++) {
    curve.time[i] = curve.time[2 * i]!;
    curve.boost[i] = curve.boost[2 * i]!;
  }
  if (curve.count % 2 === 0) {
    curve.time[kept - 1] = curve.time[curve.count - 1]!;
    curve.boost[kept - 1] = curve.boost[curve.count - 1]!;
  }
  curve.count = kept;
  curve.interval *= 2;
}

/**
 * The brightest recorded sample, taking the LAST index that attains it: the
 * boost saturates at DISC_TUNING.boostMax, so a tie is a plateau and the decay
 * starts at its right-hand end. Null until something positive is recorded,
 * since a peak of zero has no logarithm and nothing to anchor a law to.
 */
export function findPeak(curve: FlareCurve): FlarePeak | null {
  let index = -1;
  let best = 0;
  for (let i = 0; i < curve.count; i++) {
    const boost = curve.boost[i]!;
    if (boost >= best && boost > 0) {
      best = boost;
      index = i;
    }
  }
  if (index < 0) return null;
  return { index, time: curve.time[index]!, boost: best };
}

/** The fallback law anchored at the recorded peak, never fitted to it. */
export function referenceBoost(peak: FlarePeak, t: number): number {
  return peak.boost * Math.pow(t / peak.time, FALLBACK_INDEX);
}

/**
 * Where the anchored law crosses a given brightness floor. The reference is
 * drawn as a single straight log-log segment, so ending it exactly on the axis
 * floor beats clamping a point that has already fallen off the bottom.
 */
export function referenceEndTime(peak: FlarePeak, boostFloor: number): number {
  return peak.time * Math.pow(peak.boost / boostFloor, 1 / -FALLBACK_INDEX);
}

/**
 * Least-squares slope of log(boost) against log(t) over the decay only, so the
 * chart can print what the recorded curve actually does next to what the law
 * says. It is a description of the plotted series, not a measurement of the
 * fallback index: see the header for why those are not the same thing here.
 *
 * The window starts past the peak because the rise and the turnover are the
 * feeding kernel's shape, and stops at a fraction of the peak because down
 * there the boost is the exponential tail of the last few absorbed particles.
 * Returns null rather than a meaningless number when too few samples survive
 * the window or when they all share one time value.
 */
export function fitDecaySlope(curve: FlareCurve, peak: FlarePeak): number | null {
  const startTime = LIGHT_CURVE_TUNING.fitStartFactor * peak.time;
  const floor = LIGHT_CURVE_TUNING.fitFloorFraction * peak.boost;

  let n = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < curve.count; i++) {
    const t = curve.time[i]!;
    const boost = curve.boost[i]!;
    if (t < startTime || boost < floor || t <= 0 || boost <= 0) continue;
    sumX += Math.log(t);
    sumY += Math.log(boost);
    n += 1;
  }
  if (n < LIGHT_CURVE_TUNING.minFitSamples) return null;

  const meanX = sumX / n;
  const meanY = sumY / n;
  let covariance = 0;
  let varianceX = 0;
  for (let i = 0; i < curve.count; i++) {
    const t = curve.time[i]!;
    const boost = curve.boost[i]!;
    if (t < startTime || boost < floor || t <= 0 || boost <= 0) continue;
    const dx = Math.log(t) - meanX;
    covariance += dx * (Math.log(boost) - meanY);
    varianceX += dx * dx;
  }
  if (varianceX < 1e-9) return null;
  return covariance / varianceX;
}

/**
 * Log-log bounds for the recorded curve. The time axis is given at least one
 * decade so a curve that has just started is not drawn on a degenerate axis,
 * and the brightness axis shows a fixed number of decades below the peak so the
 * plot does not rescale under its own noise floor.
 */
export function axesFor(curve: FlareCurve, peak: FlarePeak): LogAxes {
  const tMin = curve.time[0]!;
  const tMax = Math.max(curve.time[curve.count - 1]!, tMin * 10);
  const boostMax = peak.boost * 1.3;
  return {
    tMin,
    tMax,
    boostMin: boostMax * Math.pow(10, -LIGHT_CURVE_TUNING.visibleDecades),
    boostMax,
  };
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0; // also catches NaN and -Infinity from log(0)
  return value < 1 ? value : 1;
}

/** Place one (t, boost) pair inside the plot box, clamping to its edges. */
export function projectPoint(
  axes: LogAxes,
  box: PlotBox,
  t: number,
  boost: number,
): PlotPoint {
  const u = (Math.log(t) - Math.log(axes.tMin)) / (Math.log(axes.tMax) - Math.log(axes.tMin));
  const v =
    (Math.log(boost) - Math.log(axes.boostMin)) /
    (Math.log(axes.boostMax) - Math.log(axes.boostMin));
  return {
    x: box.left + box.width * clamp01(u),
    y: box.top + box.height * (1 - clamp01(v)),
  };
}

/** Powers of ten inside [min, max]: the only gridlines a log axis should have. */
export function decadeTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [];
  const ticks: number[] = [];
  for (let k = Math.ceil(Math.log10(min)); k <= Math.floor(Math.log10(max)); k++) {
    ticks.push(Math.pow(10, k));
  }
  return ticks;
}
