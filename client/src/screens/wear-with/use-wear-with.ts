import type { Outfit, OutfitReaction, WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getWearWith, reactToOutfit } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';

// The model takes about 10 s; after a minute and a half the screen gives up.
const POLL_MS = 2000;
const MAX_POLLS = 45;

export type WearWithState =
  | { status: 'pending' }
  | { status: 'failed' }
  | {
      status: 'done';
      outfits: Outfit[];
      addable: WearWithRequest['addable'];
      verdict: WearWithRequest['verdict'];
      wishId: string | null;
    };

// A "what do I wear this with?" request: polled until its outfits are composed, with reactions to
// them shown at once. Shared by the outfits screen and Style it. `id` null: nothing asked yet.
export function useWearWith(id: string | null) {
  const { i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  // Kept with the request it belongs to: asking about another piece reads as pending at once,
  // without resetting state in an effect.
  const [result, setResult] = useState<{ id: string | null; state: WearWithState }>({
    id,
    state: { status: 'pending' },
  });
  const state: WearWithState = result.id === id ? result.state : { status: 'pending' };
  const setState = (next: WearWithState | ((current: WearWithState) => WearWithState)) =>
    setResult((current) => {
      const now: WearWithState = current.id === id ? current.state : { status: 'pending' };
      return { id, state: typeof next === 'function' ? next(now) : next };
    });

  // Polls the request until its outfits are composed.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const poll = async () => {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const request: WearWithRequest = await getWearWith(id, lang);
          if (cancelled) return;
          if (request.status === 'done') {
            setResult({
              id,
              state: {
                status: 'done',
                outfits: request.outfits,
                addable: request.addable,
                verdict: request.verdict,
                wishId: request.wishId,
              },
            });
            void Haptics.selectionAsync();
            return;
          }
          if (request.status === 'failed') break;
        } catch {
          // A dropped request is no reason to stop; the next poll tries again.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (!cancelled) setResult({ id, state: { status: 'failed' } });
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [id, lang]);

  // Shown at once; if the server doesn't take it, it goes back.
  async function react(outfit: Outfit, reaction: OutfitReaction) {
    if (state.status !== 'done') return;
    void Haptics.selectionAsync();
    const change = (o: Outfit): Outfit =>
      reaction === 'wore'
        ? { ...o, woreCount: o.woreCount + 1 }
        : { ...o, opinion: reaction === 'none' ? null : reaction };
    const before = state.outfits;
    setState({ ...state, outfits: before.map((o) => (o.id === outfit.id ? change(o) : o)) });
    try {
      await reactToOutfit(outfit.id, reaction);
    } catch {
      // Only this outfit goes back: reactions to the others since then stay.
      const was = before.find((o) => o.id === outfit.id) ?? outfit;
      setState((current) =>
        current.status === 'done'
          ? { ...current, outfits: current.outfits.map((o) => (o.id === outfit.id ? was : o)) }
          : current,
      );
    }
  }

  return { state, setState, react };
}
