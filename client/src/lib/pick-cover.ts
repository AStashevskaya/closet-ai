import type { Inspiration } from '@closet-ai/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

// One of the user's saved looks, a different one each day, so every screen's cover is her own
// taste; null while loading and when nothing is saved (the cover then falls back to the bright
// block).
export function pickCover(looks: Inspiration[], now = Date.now()): Inspiration | null {
  if (looks.length === 0) return null;
  return looks[Math.floor(now / DAY_MS) % looks.length]!;
}
