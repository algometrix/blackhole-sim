/**
 * End-to-end harness for the light curve: drive real disruptions through
 * stepWorld with the recorder attached and hold in place what the recorded
 * shape actually is.
 *
 * The feature was asked for on the expectation that t^(-5/3) would emerge from
 * the simulation. It does not, and these tests say so rather than papering over
 * it with a band wide enough to swallow the disagreement. The reasons are
 * written out at the top of ui/lightCurve.ts and in part 11 of docs/THEORY.md;
 * the third test below is the evidence for the main one.
 *
 * Lives next to the recorder rather than in sim/__tests__ because what is under
 * test is the recorder. It drives the world only because a synthetic curve
 * would prove nothing about what the simulation feeds it.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createWorld, placeBody, stepWorld } from '../../sim/world';
import { mulberry32 } from '../../sim/__tests__/rng';
import { LIGHT_CURVE_TUNING } from '../../config';
import type { TdeMode } from '../../settings';
import {
  createFlareCurve,
  FALLBACK_INDEX,
  findPeak,
  fitDecaySlope,
  recordFeeding,
  startFlare,
  type FlareCurve,
} from '../lightCurve';

const DT = 1 / 60;
const GW_COMPRESSION = 40;
/** The clock the app ships with, so these numbers are the ones users see. */
const SHIPPED_COMPRESSION = 8;
/**
 * Every run covers the same span of *disruption* time, so changing the
 * compression changes the feeding kernel and nothing else about the axis. One
 * thousand seconds is past the point the last debris is absorbed at every
 * compression tested, and stays inside the ring's 1024-second capacity, so no
 * run is decimated.
 */
const DISRUPTION_SECONDS = 1000;

interface DisruptionRun {
  mode: TdeMode;
  seed: number;
  timeCompression: number;
}

/** Place a star and run the sim, recording exactly what main.ts records. */
function recordDisruption({ mode, seed, timeCompression }: DisruptionRun): FlareCurve {
  const world = createWorld(16384);
  const rng = mulberry32(seed);
  const curve = createFlareCurve();
  placeBody(world, 'star', new Vector3(14, 0, 0), mode);

  const ticks = Math.round(DISRUPTION_SECONDS / timeCompression / DT);
  for (let tick = 0; tick < ticks; tick++) {
    const events = stepWorld(world, DT, { gw: GW_COMPRESSION, tde: timeCompression, beacon: 1 }, rng);
    if (events.shredNow) startFlare(curve, { mode, timeCompression });
    recordFeeding(curve, { disruptionDt: DT * timeCompression, boost: world.discBoost });
  }
  return curve;
}

function fitWindowSize(curve: FlareCurve): number {
  const peak = findPeak(curve)!;
  const startTime = LIGHT_CURVE_TUNING.fitStartFactor * peak.time;
  const floor = LIGHT_CURVE_TUNING.fitFloorFraction * peak.boost;
  let n = 0;
  for (let i = 0; i < curve.count; i++) {
    if (curve.time[i]! >= startTime && curve.boost[i]! >= floor) n++;
  }
  return n;
}

describe('what the recorded light curve does', () => {
  it('a realistic disruption records a flare that rises and then decays', () => {
    const curve = recordDisruption({
      mode: 'realistic',
      seed: 20240,
      timeCompression: SHIPPED_COMPRESSION,
    });
    const peak = findPeak(curve)!;

    expect(curve.count).toBeGreaterThan(100);
    expect(peak.boost).toBeGreaterThan(0.1);
    // A rise and a fall, not a step: the peak is strictly inside the record.
    expect(peak.index).toBeGreaterThan(0);
    expect(peak.index).toBeLessThan(curve.count - 1);
    expect(curve.boost[curve.count - 1]!).toBeLessThan(0.01 * peak.boost);
    expect(fitWindowSize(curve)).toBeGreaterThanOrEqual(12);
  });

  it('that decay is several times steeper than the fallback law', () => {
    const curve = recordDisruption({
      mode: 'realistic',
      seed: 20240,
      timeCompression: SHIPPED_COMPRESSION,
    });
    const slope = fitDecaySlope(curve, findPeak(curve)!)!;

    // Measured at about -7.3, and stable to two digits across seeds and
    // placement radii. The assertion is deliberately the qualitative claim the
    // app is allowed to make: the recorded feeding falls off far faster than
    // bound debris returning on Kepler orbits would, so the reference line on
    // the chart is there to be disagreed with. The outer bound is a sanity
    // floor, not a prediction.
    expect(slope).toBeLessThan(2 * FALLBACK_INDEX);
    expect(slope).toBeGreaterThan(-12);
  });

  it('the fitted slope tracks the feeding kernel, not the debris', () => {
    // Same disruption, same seed, same span of disruption time. The only thing
    // that changes is settings.tdeTimeCompression, which does not touch a
    // trajectory: it widens DISC_TUNING.boostDecayTau relative to this axis,
    // because the boost decays on the simulation clock while the chart is drawn
    // on the disruption clock. If the plotted decay were the debris returning,
    // this would move the fit hardly at all. It moves it by more than the
    // fallback index itself, which is why the caption prints the compression
    // it recorded at, and why the fitted number is labelled a fit.
    const fast = fittedSlope({ mode: 'realistic', seed: 20240, timeCompression: 8 });
    const slow = fittedSlope({ mode: 'realistic', seed: 20240, timeCompression: 30 });

    expect(slow - fast).toBeGreaterThan(2);
    expect(slow).toBeLessThan(FALLBACK_INDEX);
  });

  it('a cinematic disruption is recorded, and its near-miss of the law is a coincidence', () => {
    const curve = recordDisruption({
      mode: 'cinematic',
      seed: 991,
      timeCompression: SHIPPED_COMPRESSION,
    });
    const peak = findPeak(curve)!;
    const slope = fitDecaySlope(curve, peak)!;

    expect(curve.count).toBeGreaterThan(100);
    expect(peak.boost).toBeGreaterThan(0.1);
    // About -1.85, which sits close enough to -5/3 to fool someone reading the
    // caption. It is not agreement: the cinematic spiral has no energy spread
    // and no fallback at all, it is a drag inspiral, and this number moves with
    // the Disruption speed slider exactly like the realistic one does. Pinned
    // here so that resemblance can never be quietly promoted to a claim.
    expect(slope).toBeLessThan(-1.2);
    expect(slope).toBeGreaterThan(-2.5);
  });
});

/** Run one disruption and fit its decay, which has to produce a number. */
function fittedSlope(run: DisruptionRun): number {
  const curve = recordDisruption(run);
  const peak = findPeak(curve);
  expect(peak).not.toBeNull();
  const slope = fitDecaySlope(curve, peak!);
  expect(slope).not.toBeNull();
  return slope!;
}
