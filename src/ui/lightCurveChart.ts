/**
 * The light-curve overlay: a small 2D canvas that plots the disc's feeding
 * boost against time since the star came apart, on log-log axes.
 *
 * Deliberately not part of the render pipeline. Drawing it into
 * pipeline.overlayScene would push it through bloom and the camera-tour fade,
 * cost a draw call inside the raymarch pass, and leave us hand-rolling text on
 * a WebGL surface. A plain canvas on top of the app costs nothing the frame
 * loop can feel.
 *
 * It also repaints on its own timer rather than in frame(): a readout that
 * updates ten times a second is more legible than one that updates sixty, and
 * the frame loop stays free of chart work. All the maths lives in
 * ui/lightCurve.ts; this file only draws.
 */

import { LIGHT_CURVE_TUNING } from '../config';
import {
  axesFor,
  decadeTicks,
  FALLBACK_INDEX,
  findPeak,
  fitDecaySlope,
  projectPoint,
  referenceBoost,
  referenceEndTime,
  type FlareCurve,
  type FlarePeak,
  type LogAxes,
  type PlotBox,
} from './lightCurve';

/** What the chart should show right now, or null to hide it entirely. */
export interface LightCurveView {
  curve: FlareCurve;
  showReference: boolean;
}

const COLORS = {
  panel: 'rgba(10, 12, 22, 0.62)',
  border: 'rgba(159, 216, 232, 0.18)',
  grid: 'rgba(159, 216, 232, 0.14)',
  label: 'rgba(159, 216, 232, 0.72)',
  curve: '#ffd9a0',
  reference: 'rgba(120, 200, 235, 0.85)',
};

const FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
/**
 * Room for the brightness labels on the left, the caption above, and the time
 * labels plus the axis name below.
 */
const MARGIN = { left: 36, right: 10, top: 18, bottom: 28 };

/** 0.001 rather than 0.001000000001: a tick label, not a measurement. */
function formatDecade(value: number): string {
  const exponent = Math.round(Math.log10(value));
  return exponent >= 0 ? String(Math.round(value)) : value.toFixed(-exponent);
}

/** Short enough that the caption still fits the phone width beside the mode. */
function formatSlope(slope: number | null): string {
  return slope === null ? 'pending' : slope.toFixed(2);
}

export class LightCurveChart {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly timer: number;
  /** What was last drawn, so a steady chart costs one string compare. */
  private lastDrawn = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly readView: () => LightCurveView | null,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Disruption light curve, nothing recorded yet');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('light curve needs a 2D canvas context');
    this.context = context;
    this.container.appendChild(this.canvas);
    this.timer = window.setInterval(() => this.repaint(), LIGHT_CURVE_TUNING.repaintMs);
  }

  /** Stop the repaint timer. The page never does; tests and HMR do. */
  dispose(): void {
    window.clearInterval(this.timer);
    this.canvas.remove();
  }

  private repaint(): void {
    const view = this.readView();
    if (!view) {
      this.container.classList.remove('visible');
      this.lastDrawn = '';
      return;
    }
    // Sized after the class is set: the container is display:none until then,
    // so measuring it first would give zero.
    this.container.classList.add('visible');

    const cssWidth = this.container.clientWidth;
    const cssHeight = this.container.clientHeight;
    if (cssWidth < 1 || cssHeight < 1) return;

    const peak = findPeak(view.curve);
    const signature = [
      view.curve.count,
      peak?.index ?? -1,
      view.showReference,
      cssWidth,
      cssHeight,
    ].join('|');
    if (signature === this.lastDrawn) return;
    this.lastDrawn = signature;

    // Capped at 2: a 3x phone would otherwise fill 780x450 device pixels of 2D
    // work ten times a second on the thread that submits the WebGL frame.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const deviceWidth = Math.round(cssWidth * ratio);
    const deviceHeight = Math.round(cssHeight * ratio);
    if (this.canvas.width !== deviceWidth || this.canvas.height !== deviceHeight) {
      this.canvas.width = deviceWidth;
      this.canvas.height = deviceHeight;
    }
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw(view, peak, cssWidth, cssHeight);
  }

  private draw(
    view: LightCurveView,
    peak: FlarePeak | null,
    width: number,
    height: number,
  ): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.panel;
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.fillRect(0.5, 0.5, width - 1, height - 1);
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';

    if (!peak) {
      ctx.fillStyle = COLORS.label;
      ctx.textAlign = 'center';
      ctx.fillText('waiting for a disruption', width / 2, height / 2);
      this.canvas.setAttribute('aria-label', 'Disruption light curve, nothing recorded yet');
      return;
    }

    const box: PlotBox = {
      left: MARGIN.left,
      top: MARGIN.top,
      width: Math.max(width - MARGIN.left - MARGIN.right, 1),
      height: Math.max(height - MARGIN.top - MARGIN.bottom, 1),
    };
    const axes = axesFor(view.curve, peak);
    this.drawGrid(axes, box);
    if (view.showReference) this.drawReference(axes, box, peak);
    this.drawCurve(view.curve, axes, box);

    const slope = fitDecaySlope(view.curve, peak);
    this.drawCaption(view.curve, box, slope);
    const decay =
      slope === null
        ? 'decay not yet fitted'
        : `fitted log-log decay slope ${slope.toFixed(2)} against a fallback law of ${FALLBACK_INDEX.toFixed(2)}`;
    this.canvas.setAttribute(
      'aria-label',
      `Disruption light curve, ${view.curve.count} samples, peak feeding boost ${peak.boost.toFixed(2)}, ${decay}`,
    );
  }

  private drawGrid(axes: LogAxes, box: PlotBox): void {
    const ctx = this.context;
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.label;
    ctx.beginPath();
    ctx.rect(box.left + 0.5, box.top + 0.5, box.width, box.height);
    ctx.stroke();

    ctx.textAlign = 'right';
    for (const tick of decadeTicks(axes.boostMin, axes.boostMax)) {
      const { y } = projectPoint(axes, box, axes.tMin, tick);
      ctx.beginPath();
      ctx.moveTo(box.left, Math.round(y) + 0.5);
      ctx.lineTo(box.left + box.width, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(formatDecade(tick), box.left - 4, y);
    }

    ctx.textAlign = 'center';
    for (const tick of decadeTicks(axes.tMin, axes.tMax)) {
      const { x } = projectPoint(axes, box, tick, axes.boostMax);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, box.top);
      ctx.lineTo(Math.round(x) + 0.5, box.top + box.height);
      ctx.stroke();
      // Nudged off the ends so a wide label ("1000") stays on the canvas: the
      // last decade tick usually lands on the right edge of the box.
      const labelX = Math.min(Math.max(x, box.left + 14), box.left + box.width - 14);
      ctx.fillText(formatDecade(tick), labelX, box.top + box.height + 8);
    }

    ctx.fillText('t (disruption s)', box.left + box.width / 2, box.top + box.height + 20);
    // The brightness axis is named inside the box: naming it on the left would
    // cost another 12px of a chart that is 260px wide on a phone.
    ctx.textAlign = 'left';
    ctx.fillText('disc boost', box.left + 4, box.top + 8);
  }

  /**
   * One straight segment from the peak to wherever the law crosses the floor
   * of the brightness axis. Anchored at the peak, never fitted, so if the
   * recorded curve disagrees with the law the gap is on screen.
   */
  private drawReference(axes: LogAxes, box: PlotBox, peak: FlarePeak): void {
    const end = Math.min(referenceEndTime(peak, axes.boostMin), axes.tMax);
    if (!(end > peak.time)) return;

    const from = projectPoint(axes, box, peak.time, peak.boost);
    const to = projectPoint(axes, box, end, referenceBoost(peak, end));
    const ctx = this.context;
    ctx.save();
    ctx.strokeStyle = COLORS.reference;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawCurve(curve: FlareCurve, axes: LogAxes, box: PlotBox): void {
    const ctx = this.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    ctx.clip();
    ctx.strokeStyle = COLORS.curve;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < curve.count; i++) {
      const point = projectPoint(axes, box, curve.time[i]!, curve.boost[i]!);
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Both numbers, side by side, because they disagree and the chart must not
   * hide that. The compression shown is the one recorded at disruption: it sets
   * the width of the feeding kernel relative to this time axis, and it is the
   * single strongest influence on the fitted slope. Moving the slider mid-flare
   * changes that and the caption cannot show it.
   */
  private drawCaption(curve: FlareCurve, box: PlotBox, slope: number | null): void {
    const ctx = this.context;
    const recorded = curve.mode ? `${curve.mode} x${curve.timeCompression.toFixed(0)}` : 'idle';
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = 'left';
    ctx.fillText(recorded, box.left, box.top - 9);
    ctx.textAlign = 'right';
    ctx.fillText(
      `fit ${formatSlope(slope)} · law ${FALLBACK_INDEX.toFixed(2)}`,
      box.left + box.width,
      box.top - 9,
    );
  }
}
