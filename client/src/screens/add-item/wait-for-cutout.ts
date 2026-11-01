import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';

import { absoluteUrl, getItem, sessionHeaders } from '@/lib/api';

// The cut-out is usually made a second or two after the item is saved (SAM 3 on fal). The
// screen waits this long for it, asking this often, before the photo flies instead.
export const CUTOUT_POLL_MS = 500;
export const CUTOUT_WAIT_MS = 5000;

// What flies to the rail: the cut-out, already in the image cache, and the session to load it with.
export type Cutout = { uri: string; headers: Record<string, string> };

// Waits for a just-saved item's cut-out and loads it, so "Hang it up" flies the bare piece and
// not the photo with its background (owner, 2026-11-01: "with a piece of bed"). Null when none
// comes in time: cut-outs off, the cut failed, a photo of the piece worn (those never get one),
// or the image wouldn't load. Stops at once when `signal` aborts (the sheet closed).
export async function waitForCutout(item: Item, signal: AbortSignal): Promise<Cutout | null> {
  let path = item.cutoutUrl ?? null;
  for (let waited = 0; !path && waited < CUTOUT_WAIT_MS; waited += CUTOUT_POLL_MS) {
    await pause(CUTOUT_POLL_MS, signal);
    if (signal.aborted) return null;
    try {
      const latest = await getItem(item.id);
      path = latest.cutoutUrl ?? null;
      // The photo itself failed: no cut-out will follow it.
      if (!path && latest.photoStatus === 'failed') return null;
    } catch {
      // A dropped request is no reason to stop; the next poll tries again.
    }
  }
  if (!path || signal.aborted) return null;
  try {
    const headers = await sessionHeaders();
    const uri = absoluteUrl(path);
    // Loaded before it flies, so the piece doesn't appear blank on the way.
    const loaded = await Image.prefetch(uri, { headers });
    return loaded && !signal.aborted ? { uri, headers } : null;
  } catch {
    return null;
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
