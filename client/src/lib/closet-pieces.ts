import type { Item } from '@closet-ai/shared';
import { useEffect, useState } from 'react';

import { listItems, sessionHeaders } from '@/lib/api';

// Which of her pieces can hang as decoration, up to `max`: cut-outs first (a bare piece is how the
// closet looks), then photos still waiting for one. Shoes stand on a floor line in the closet, so
// they don't hang here; a piece with no picture yet has nothing to show.
export function piecesToHang(items: Item[], max: number): Item[] {
  const hanging = items.filter((item) => item.category !== 'shoes' && item.photoUrl);
  return [
    ...hanging.filter((item) => item.cutoutUrl),
    ...hanging.filter((item) => !item.cutoutUrl),
  ].slice(0, max);
}

// What was last read, shared between screens: the pick screen's read also serves the wait that
// follows it, whose rail then has her pieces from the start. An older read shows at once and is
// read again behind it, so a piece added since turns up.
const FRESH_MS = 60_000;
type Loaded = { items: Item[]; headers: Record<string, string>; at: number };
let cache: Loaded | null = null;
let loading: Promise<void> | null = null;
// Counts the accounts: a read that started under the last one must not land in this one's cache.
let account = 0;

// Forgets it all, so one account's pieces never show for another. The root layout calls this when
// the signed-in user changes, which covers signing out, deleting the account and a session expiring.
export function clearClosetPieces() {
  cache = null;
  loading = null;
  account += 1;
}

function load() {
  const startedUnder = account;
  loading ??= Promise.all([listItems(), sessionHeaders()])
    .then(([items, headers]) => {
      if (startedUnder === account) cache = { items, headers, at: Date.now() };
    })
    // Silent on purpose: the rail works without them.
    .catch(() => undefined)
    .finally(() => {
      if (startedUnder === account) loading = null;
    });
  return loading;
}

// Her real pieces for a screen that dresses its rail with them. Only decoration: while they load, or
// if they can't be, there are simply none, and nothing about it reaches her.
export function useClosetPieces(max: number) {
  const [loaded, setLoaded] = useState(() => cache);

  useEffect(() => {
    if (cache && Date.now() - cache.at < FRESH_MS) return;
    let cancelled = false;
    void load().then(() => {
      if (!cancelled && cache) setLoaded(cache);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { pieces: loaded ? piecesToHang(loaded.items, max) : [], headers: loaded?.headers };
}
