import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';

import { absoluteUrl, getItem, sessionHeaders } from '@/lib/api';

// The cut-out is usually made a second or two after the item is saved (SAM 3 on fal). The
// screen waits at most this long for it, by the clock, asking this often, before the photo
// flies instead.
export const CUTOUT_POLL_MS = 500;
export const CUTOUT_WAIT_MS = 5000;

// What flies to the rail: the cut-out, already in the image cache, and the session to load it with.
export type Cutout = { uri: string; headers: Record<string, string> };

// Waits for a just-saved item's cut-out and loads it, so "Hang it up" flies the bare piece and
// not the photo with its background (owner, 2026-11-01: "with a piece of bed"). Null when none
// comes in time: cut-outs off, the cut failed, a photo of the piece worn (those never get one),
// or the image wouldn't load. The deadline holds even for a request that hangs on a bad network,
// and everything stops at once when `signal` aborts (the sheet closed).
export async function waitForCutout(item: Item, signal: AbortSignal): Promise<Cutout | null> {
  const deadline = Date.now() + CUTOUT_WAIT_MS;
  const left = () => deadline - Date.now();
  let path = item.cutoutUrl ?? null;
  while (!path) {
    await pause(Math.min(CUTOUT_POLL_MS, left()), signal);
    if (signal.aborted || left() <= 0) return null;
    const latest = await within(getItem(item.id), left(), signal);
    if (signal.aborted) return null;
    // Timed out or dropped: the next poll tries again, while there's time.
    if (!latest) continue;
    path = latest.cutoutUrl ?? null;
    // The photo itself failed: no cut-out will follow it.
    if (!path && latest.photoStatus === 'failed') return null;
  }
  const headers = await within(sessionHeaders(), left(), signal);
  if (!headers || signal.aborted) return null;
  const uri = absoluteUrl(path);
  // Loaded before it flies, so the piece doesn't appear blank on the way.
  const loaded = await within(Image.prefetch(uri, { headers }), left(), signal);
  return loaded && !signal.aborted ? { uri, headers } : null;
}

// Waits `ms`, or less if `signal` aborts first.
export function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

// What `promise` gives within `ms`, or undefined if it fails, takes longer or `signal` aborts.
function within<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve(undefined);
    const timer = setTimeout(() => finish(undefined), ms);
    signal.addEventListener('abort', onAbort);
    promise.then(finish, () => finish(undefined));
    function onAbort() {
      finish(undefined);
    }
    function finish(value: T | undefined) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }
  });
}
