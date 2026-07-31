/**
 * What kind of device is this, in the only terms the app actually cares about.
 *
 * Deliberately not "is it a phone". The question that decides the layout is
 * whether the primary pointer is a finger, because that is what makes hover
 * text, keyboard shortcuts and 20px hit targets useless.
 */

/**
 * True when the *primary* pointer is a finger or stylus.
 *
 * This is the whole test, on purpose. An earlier version also required a small
 * screen, which left tablets on the desktop layout: a floating panel over a
 * quarter of the screen, no way to hide the interface without a keyboard, and
 * a desktop render budget on a mobile GPU. A touchscreen laptop is not caught
 * by this, because with a mouse attached the primary pointer is fine;
 * `any-pointer: coarse` would be the query that wrongly catches it.
 */
export function usesTouchUi(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * Render budget for a touch device. A phone or tablet GPU is a fraction of a
 * desktop card while reporting a device pixel ratio of 2 or 3, so an
 * unthrottled raymarch draws several times the pixels on a fraction of the
 * hardware. Start cheap and let the existing auto-degrade take it further; the
 * quality control is right there if the device turns out to have headroom.
 */
export function touchRenderBudget(): { pixelRatio: number; skyFaceSize: number } {
  return { pixelRatio: 1.25, skyFaceSize: 512 };
}
