/**
 * Cinematic mode: the control panel and HUD fade away so the render fills the
 * screen like a wallpaper. One class on <body> drives the CSS; a toast (which
 * stays visible in either mode) says how to get the controls back.
 */

const CINEMATIC_CLASS = 'cinematic';
const TOAST_VISIBLE_MS = 2600;

export class CinematicMode {
  private hidden = false;
  private toastTimer = 0;

  constructor(
    private readonly body: HTMLElement,
    private readonly toast: HTMLElement,
  ) {}

  /** True while the panel and HUD are hidden. */
  get isActive(): boolean {
    return this.hidden;
  }

  toggle(): void {
    this.hidden = !this.hidden;
    this.apply();
  }

  /** Presets state whether they want the chrome hidden, rather than flipping it. */
  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.apply();
  }

  show(): void {
    if (!this.hidden) return;
    this.hidden = false;
    this.apply();
  }

  private apply(): void {
    this.body.classList.toggle(CINEMATIC_CLASS, this.hidden);
    this.flash(this.hidden ? 'cinematic mode · press H for the controls' : 'controls restored');
  }

  private flash(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => this.toast.classList.remove('visible'),
      TOAST_VISIBLE_MS,
    );
  }
}

/** Keyboard shortcuts must not fire while the user is typing into the panel. */
export function isTypingIntoControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.matches('input, select, textarea');
}
