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

// Her real pieces for a screen that dresses its rail with them. Only decoration: while they load, or
// if they can't be, there are simply none, and nothing about it reaches her.
export function useClosetPieces(max: number) {
  const [pieces, setPieces] = useState<Item[]>([]);
  const [headers, setHeaders] = useState<Record<string, string>>();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [items, session] = await Promise.all([listItems(), sessionHeaders()]);
        if (cancelled) return;
        setHeaders(session);
        setPieces(piecesToHang(items, max));
      } catch {
        // Silent on purpose: the rail works without them.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [max]);

  return { pieces, headers };
}
