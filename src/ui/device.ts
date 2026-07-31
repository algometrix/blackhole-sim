/**
 * What kind of device is this, in the only terms the app actually cares about.
 *
 * Deliberately not "is it a phone". The questions worth asking are whether the
 * pointer is a finger (so hover text and a keyboard shortcut are useless) and
 * whether the screen is small enough that a 245px panel would swallow it.
 */

/** A finger or stylus rather than a mouse: no hover, no keyboard shortcuts. */
export function hasCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Narrow enough that the control panel would cover most of the render. */
export function hasCompactScreen(): boolean {
  return Math.min(window.innerWidth, window.innerHeight) < 620;
}

/**
 * Treat as mobile when both are true. A touchscreen laptop keeps the desktop
 * layout, and a narrow desktop window keeps its keyboard shortcuts; only a
 * device that is both small and finger-driven gets the phone treatment.
 */
export function isMobile(): boolean {
  return hasCoarsePointer() && hasCompactScreen();
}

/**
 * Render budget for this device. Phone GPUs are perhaps a tenth of a desktop
 * card, and a phone screen reports a device pixel ratio of 3, so an
 * unthrottled raymarch renders nine times the pixels on a tenth of the
 * hardware. Cap the ratio and start at the cheapest preset; the existing
 * auto-degrade handles anything still too slow.
 */
export function mobileRenderBudget(): { pixelRatio: number; skyFaceSize: number } {
  return { pixelRatio: 1.25, skyFaceSize: 512 };
}
