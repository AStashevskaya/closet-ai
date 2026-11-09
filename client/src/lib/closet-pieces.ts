import type { Item } from '@closet-ai/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { listItems, sessionHeaders } from '@/lib/api';
import { onClosetChanged } from '@/lib/closet-changes';

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

// What was last read, shared between screens, which see each new read while they're on screen: the
// pick screen's read also serves the wait that follows it. A read older than this, or one from
// before a change made in this app, shows at once and is read again. The minute covers what the app
// doesn't hear of: a cut-out arriving, another phone.
const FRESH_MS = 60_000;
type Store = {
  loaded: { items: Item[]; headers: Record<string, string> } | null;
  reading: boolean;
  // How many reads have ended, however they ended.
  ended: number;
};
let store: Store = { loaded: null, reading: false, ended: 0 };
let readAt = 0;
// Only the newest read may land. Anything that makes a read on its way worthless (another account,
// a change to the closet) moves this on, so that read never lands.
let newestRead = 0;
const screens = new Set<() => void>();

function update(next: Partial<Store>) {
  store = { ...store, ...next };
  screens.forEach((screen) => screen());
}

function read() {
  if (store.reading) return;
  newestRead += 1;
  const thisRead = newestRead;
  update({ reading: true });
  Promise.all([listItems(), sessionHeaders()]).then(
    ([items, headers]) => {
      if (thisRead !== newestRead) return;
      readAt = Date.now();
      update({ loaded: { items, headers }, reading: false, ended: store.ended + 1 });
    },
    // Silent on purpose: what was read stays, and the rail works without any. Still stale, so the
    // next screen tries again.
    () => {
      if (thisRead === newestRead) update({ reading: false, ended: store.ended + 1 });
    },
  );
}

function dropReadOnItsWay() {
  newestRead += 1;
  readAt = 0;
  return store.reading ? { reading: false, ended: store.ended + 1 } : {};
}

const isFresh = () => store.loaded !== null && Date.now() - readAt < FRESH_MS;

// Forgets it all, so one account's pieces never show for another. The root layout calls this when
// the signed-in user changes, which covers signing out, deleting the account and a session expiring.
export function clearClosetPieces() {
  update({ ...dropReadOnItsWay(), loaded: null });
}

// A change in the closet: the next read is a real one, at once if a screen is showing the pieces.
onClosetChanged(() => {
  update(dropReadOnItsWay());
  if (screens.size > 0) read();
});

function subscribe(screen: () => void) {
  screens.add(screen);
  return () => {
    screens.delete(screen);
  };
}

// Her real pieces for a screen that dresses its rail with them. Only decoration: while they load, or
// if they can't be, there are simply none, and nothing about it reaches her. `refreshing`: a better
// list may be on its way, for a screen that would rather not start on this one.
export function useClosetPieces(max: number) {
  const { loaded, reading, ended } = useSyncExternalStore(subscribe, () => store);
  // What this screen found on arrival: a stale list is being read again from its first render, though
  // the read itself only starts in the effect below.
  const [arrival] = useState(() => ({ fresh: isFresh(), ended: store.ended }));

  useEffect(() => {
    if (!isFresh()) read();
  }, []);

  return {
    pieces: loaded ? piecesToHang(loaded.items, max) : [],
    headers: loaded?.headers,
    refreshing: reading || (!arrival.fresh && ended === arrival.ended),
  };
}
