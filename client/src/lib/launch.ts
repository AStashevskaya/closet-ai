// The launch hand-off ("Запуск", decided 2026-11-12, direction B): the launch screen's hanger
// becomes the first rail the app shows. That rail says where its line is; the curtain over the
// app reads it. Once the curtain has gone, nothing is waiting for a rail any more.

// From the moment the app is ready to the hanger's bar lying on the first rail: the closet's
// pieces start hanging in then, rather than unseen under the curtain.
export const LAUNCH_HANDOFF_MS = 700;

let launching = true;
let railY: number | null = null;
const listeners = new Set<() => void>();

// The first rail's line, its middle, from the top of the window.
export function reportLaunchRail(y: number) {
  if (!launching) return;
  railY = y;
  for (const listener of listeners) listener();
}

export function launchRailY() {
  return railY;
}

export function onLaunchRail(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// True from the app's start until the curtain has gone: a screen mounted meanwhile is under it.
export function isLaunching() {
  return launching;
}

export function launchDone() {
  launching = false;
  railY = null;
  listeners.clear();
}
