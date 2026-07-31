import { describe, expect, it } from 'vitest';
import { LIGHT_CURVE_TUNING } from '../../config';
import {
  axesFor,
  createFlareCurve,
  decadeTicks,
  FALLBACK_INDEX,
  findPeak,
  fitDecaySlope,
  halveResolution,
  projectPoint,
  recordFeeding,
  referenceBoost,
  referenceEndTime,
  resetFlare,
  startFlare,
  type FlareCurve,
} from '../lightCurve';

const BOX = { left: 10, top: 5, width: 200, height: 100 };

/** A curve holding exactly these samples, as if they had been recorded. */
function curveOf(times: readonly number[], boosts: readonly number[]): FlareCurve {
  const curve = createFlareCurve({ capacity: Math.max(times.length, 1) });
  startFlare(curve, { mode: 'realistic', timeCompression: 8 });
  for (let i = 0; i < times.length; i++) {
    curve.time[i] = times[i]!;
    curve.boost[i] = boosts[i]!;
  }
  curve.count = times.length;
  return curve;
}

/** boost = amplitude * (t / tRef)^index, the shape the fit has to recover. */
function powerLawCurve(index: number, amplitude: number, tRef: number, samples: number): FlareCurve {
  const times: number[] = [];
  const boosts: number[] = [];
  for (let k = 0; k < samples; k++) {
    const t = tRef * (k + 1);
    times.push(t);
    boosts.push(amplitude * Math.pow(t / tRef, index));
  }
  return curveOf(times, boosts);
}

describe('recordFeeding', () => {
  it('samples on the configured interval', () => {
    const curve = createFlareCurve({ sampleInterval: 2 });
    startFlare(curve, { mode: 'realistic', timeCompression: 8 });
    for (let step = 0; step < 200; step++) recordFeeding(curve, { disruptionDt: 0.5, boost: 1 });

    expect(curve.elapsed).toBeCloseTo(100, 6);
    expect(curve.count).toBe(50);
    for (let i = 1; i < curve.count; i++) {
      expect(curve.time[i]!).toBeGreaterThan(curve.time[i - 1]!);
      expect(curve.time[i]! - curve.time[i - 1]!).toBeLessThanOrEqual(2 + 0.5);
    }
  });

  it('records nothing before a flare starts', () => {
    const curve = createFlareCurve({ sampleInterval: 2 });
    for (let step = 0; step < 500; step++) recordFeeding(curve, { disruptionDt: 0.5, boost: 1 });

    expect(curve.count).toBe(0);
    expect(curve.elapsed).toBe(0);
    expect(findPeak(curve)).toBeNull();
  });

  it('never exceeds capacity, and keeps both ends of the record', () => {
    const capacity = 16;
    const interval = 1;
    const curve = createFlareCurve({ capacity, sampleInterval: interval });
    startFlare(curve, { mode: 'realistic', timeCompression: 8 });

    // Feeding boost = elapsed time, so every stored pair is self-checking.
    const steps = 4 * capacity * interval * 4;
    for (let step = 0; step < steps; step++) {
      recordFeeding(curve, { disruptionDt: 0.25, boost: curve.elapsed + 0.25 });
    }

    expect(curve.count).toBeLessThanOrEqual(capacity);
    expect(curve.interval).toBeGreaterThanOrEqual(4 * interval);
    for (let i = 0; i < curve.count; i++) {
      expect(curve.boost[i]!).toBeCloseTo(curve.time[i]!, 3);
      if (i > 0) expect(curve.time[i]!).toBeGreaterThan(curve.time[i - 1]!);
    }
    // The newest sample is never the one thrown away: it is still within one
    // (decimated) interval of now.
    expect(curve.elapsed - curve.time[curve.count - 1]!).toBeLessThan(curve.interval);
  });
});

describe('halveResolution', () => {
  it('keeps the head and the newest sample of an even-length record', () => {
    const curve = curveOf([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1]);
    halveResolution(curve);

    expect(curve.count).toBe(3);
    expect(Array.from(curve.time.slice(0, 3))).toEqual([1, 3, 6]);
    expect(Array.from(curve.boost.slice(0, 3))).toEqual([6, 4, 1]);
    expect(curve.interval).toBe(2 * curve.baseInterval);
  });

  it('keeps the head and the newest sample of an odd-length record', () => {
    const curve = curveOf([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    halveResolution(curve);

    expect(curve.count).toBe(3);
    expect(Array.from(curve.time.slice(0, 3))).toEqual([1, 3, 5]);
  });
});

describe('findPeak', () => {
  it('returns the last index of a saturated plateau', () => {
    const curve = curveOf([1, 2, 3, 4, 5, 6], [0.5, 2, 2, 2, 1, 0.4]);
    const peak = findPeak(curve)!;

    expect(peak.boost).toBe(2);
    expect(peak.time).toBe(4); // the end of the plateau, where the decay starts
    expect(peak.index).toBe(3);
  });

  it('returns null with nothing recorded and with nothing positive recorded', () => {
    expect(findPeak(createFlareCurve())).toBeNull();
    expect(findPeak(curveOf([1, 2, 3], [0, 0, 0]))).toBeNull();
  });
});

describe('referenceBoost', () => {
  it('is the fallback power law anchored at the peak', () => {
    const peak = { index: 0, time: 12, boost: 0.8 };

    expect(referenceBoost(peak, 12)).toBeCloseTo(0.8, 12);
    // 8^(5/3) = 32, so eight peak-times in the law has dropped by 32.
    expect(referenceBoost(peak, 8 * 12)).toBeCloseTo(0.8 / 32, 12);
  });

  it('has log-log slope exactly -5/3 between any two points', () => {
    const peak = { index: 0, time: 3, boost: 1.4 };
    const a = 7.5;
    const b = 91.2;
    const slope =
      (Math.log(referenceBoost(peak, b)) - Math.log(referenceBoost(peak, a))) /
      (Math.log(b) - Math.log(a));

    expect(slope).toBeCloseTo(FALLBACK_INDEX, 12);
  });
});

describe('referenceEndTime', () => {
  it('lands exactly on the brightness floor', () => {
    const peak = { index: 0, time: 9, boost: 1.1 };
    const floor = 0.0013;

    expect(referenceBoost(peak, referenceEndTime(peak, floor))).toBeCloseTo(floor, 9);
  });

  it('is later than the peak for any floor below it', () => {
    const peak = { index: 0, time: 9, boost: 1.1 };
    expect(referenceEndTime(peak, 0.2)).toBeGreaterThan(peak.time);
  });
});

describe('fitDecaySlope', () => {
  it('recovers a synthetic fallback index', () => {
    const curve = powerLawCurve(FALLBACK_INDEX, 0.7, 1, 12);
    const slope = fitDecaySlope(curve, findPeak(curve)!)!;

    expect(slope).toBeCloseTo(FALLBACK_INDEX, 6);
  });

  it('recovers a flat decay as zero', () => {
    const times = [1];
    const boosts = [1];
    for (let k = 2; k <= 40; k++) {
      times.push(k);
      boosts.push(0.5);
    }
    const curve = curveOf(times, boosts);

    expect(fitDecaySlope(curve, findPeak(curve)!)!).toBeCloseTo(0, 12);
  });

  it('ignores the smeared peak the window is set to exclude', () => {
    const decay = powerLawCurve(FALLBACK_INDEX, 0.7, 1, 12);
    const clean = fitDecaySlope(decay, findPeak(decay)!)!;

    // Same decay, with a rising limb and a shallow turnover glued in front of
    // it at times below fitStartFactor * peakTime.
    const peakTime = 1;
    const times = [peakTime * 0.4, peakTime * 0.7, peakTime, peakTime * 1.2, peakTime * 1.4];
    const boosts = [0.2, 0.5, 0.7, 0.69, 0.68];
    for (let i = 0; i < decay.count; i++) {
      if (decay.time[i]! <= peakTime * 1.4) continue;
      times.push(decay.time[i]!);
      boosts.push(decay.boost[i]!);
    }
    const smeared = curveOf(times, boosts);
    const peak = findPeak(smeared)!;
    expect(peak.time).toBe(peakTime);

    expect(fitDecaySlope(smeared, peak)!).toBeCloseTo(clean, 6);
  });

  it('returns null rather than a slope through too few points', () => {
    const short = powerLawCurve(FALLBACK_INDEX, 0.7, 1, LIGHT_CURVE_TUNING.minFitSamples);
    expect(fitDecaySlope(short, findPeak(short)!)).toBeNull();
  });

  it('returns null when every fitted sample shares one time value', () => {
    const times = [1];
    const boosts = [1];
    for (let k = 0; k < LIGHT_CURVE_TUNING.minFitSamples + 1; k++) {
      times.push(5);
      boosts.push(0.5);
    }
    const curve = curveOf(times, boosts);

    expect(fitDecaySlope(curve, findPeak(curve)!)).toBeNull();
  });
});

describe('axesFor', () => {
  it('brackets every recorded sample with ordered, finite bounds', () => {
    const curve = powerLawCurve(FALLBACK_INDEX, 0.7, 3, 20);
    const axes = axesFor(curve, findPeak(curve)!);

    expect(axes.tMin).toBeLessThan(axes.tMax);
    expect(axes.boostMin).toBeLessThan(axes.boostMax);
    for (let i = 0; i < curve.count; i++) {
      expect(curve.time[i]!).toBeGreaterThanOrEqual(axes.tMin);
      expect(curve.time[i]!).toBeLessThanOrEqual(axes.tMax);
    }
    expect(axes.boostMax).toBeGreaterThan(findPeak(curve)!.boost);
  });

  it('gives a single-sample curve a decade of time headroom', () => {
    const curve = curveOf([4], [0.5]);
    const axes = axesFor(curve, findPeak(curve)!);

    expect(Number.isFinite(axes.tMax)).toBe(true);
    expect(axes.tMax).toBe(40);
    expect(axes.boostMin).toBeGreaterThan(0);
    expect(axes.boostMin).toBeLessThan(axes.boostMax);
  });
});

describe('projectPoint', () => {
  const axes = { tMin: 1, tMax: 1000, boostMin: 0.001, boostMax: 1 };

  it('maps the axis corners to the box corners', () => {
    const bottomLeft = projectPoint(axes, BOX, axes.tMin, axes.boostMin);
    expect(bottomLeft.x).toBeCloseTo(BOX.left, 9);
    expect(bottomLeft.y).toBeCloseTo(BOX.top + BOX.height, 9);

    const topRight = projectPoint(axes, BOX, axes.tMax, axes.boostMax);
    expect(topRight.x).toBeCloseTo(BOX.left + BOX.width, 9);
    expect(topRight.y).toBeCloseTo(BOX.top, 9);
  });

  it('moves right with time and up with brightness', () => {
    const early = projectPoint(axes, BOX, 3, 0.1);
    const late = projectPoint(axes, BOX, 300, 0.1);
    expect(late.x).toBeGreaterThan(early.x);

    const dim = projectPoint(axes, BOX, 30, 0.01);
    const bright = projectPoint(axes, BOX, 30, 0.5);
    expect(bright.y).toBeLessThan(dim.y);
  });

  it('clamps anything outside the axes into the box', () => {
    for (const [t, boost] of [
      [1e-6, 1e-9],
      [1e9, 1e6],
      [0, 0],
    ] as const) {
      const point = projectPoint(axes, BOX, t, boost);
      expect(point.x).toBeGreaterThanOrEqual(BOX.left);
      expect(point.x).toBeLessThanOrEqual(BOX.left + BOX.width);
      expect(point.y).toBeGreaterThanOrEqual(BOX.top);
      expect(point.y).toBeLessThanOrEqual(BOX.top + BOX.height);
    }
  });
});

describe('decadeTicks', () => {
  it('returns the powers of ten inside the range', () => {
    expect(decadeTicks(0.5, 120)).toEqual([1, 10, 100]);
    for (const tick of decadeTicks(0.5, 120)) {
      expect(tick).toBeGreaterThanOrEqual(0.5);
      expect(tick).toBeLessThanOrEqual(120);
    }
  });

  it('returns nothing when the range spans no decade boundary', () => {
    expect(decadeTicks(2, 9)).toEqual([]);
  });

  it('returns nothing for a degenerate or non-positive range', () => {
    expect(decadeTicks(0, 100)).toEqual([]);
    expect(decadeTicks(-5, 100)).toEqual([]);
    expect(decadeTicks(100, 100)).toEqual([]);
  });
});

describe('resetFlare', () => {
  it('clears the record and restores the shipped sampling interval', () => {
    const curve = createFlareCurve({ capacity: 8, sampleInterval: 1 });
    startFlare(curve, { mode: 'realistic', timeCompression: 8 });
    for (let step = 0; step < 400; step++) {
      recordFeeding(curve, { disruptionDt: 0.25, boost: 1 });
    }
    expect(curve.interval).toBeGreaterThan(curve.baseInterval);

    resetFlare(curve);

    expect(curve.count).toBe(0);
    expect(curve.elapsed).toBe(0);
    expect(curve.lastSampleAt).toBe(0);
    expect(curve.recording).toBe(false);
    expect(curve.mode).toBeNull();
    expect(curve.interval).toBe(curve.baseInterval);
    expect(findPeak(curve)).toBeNull();
  });
});
