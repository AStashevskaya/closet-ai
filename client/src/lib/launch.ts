// The launch hand-off ("Запуск", decided 2026-11-12, direction B): the launch screen's hanger
// becomes the first rail the app shows. That rail offers a way to measure where its line is, and
// the curtain over the app measures it at the moment it lands, so a block that came in above the
// rail meanwhile (the style card, "New in") is taken into account. Once the curtain has gone,
// nothing waits for a rail any more.

// From the moment the app is ready to the hanger's bar lying on the first rail: the closet's
// pieces start hanging in then, rather than unseen under the curtain.
export const LAUNCH_HANDOFF_MS = 700;

// Measures the rail's line: its middle, from the top of the window.
export type MeasureRail = (done: (y: number) => void) => void;

let launching = true;
let rail: MeasureRail | null = null;
const listeners = new Set<() => void>();

// Offered by the first rail while the app launches; taken back when that rail goes.
export function offerLaunchRail(measure: MeasureRail) {
  if (!launching) return () => {};
  rail = measure;
  for (const listener of listeners) listener();
  return () => {
    if (rail === measure) rail = null;
  };
}

export function launchRail() {
  return rail;
}

export function onLaunchRail(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// True from the app's start until the curtain has gone: a screen mounted meanwhile is under it.
// Kept here rather than in the curtain, so a remount (Fast Refresh) doesn't bring the curtain back.
export function isLaunching() {
  return launching;
}

export function launchDone() {
  launching = false;
  rail = null;
  listeners.clear();
}
