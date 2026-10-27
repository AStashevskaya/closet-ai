import type { Outfit, OutfitReaction, WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo } from 'react-native';

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
  // Changes the outfits of request `of` only: an answer for a piece the user has since left
  // (a reaction failing late) must not touch the piece now on screen.
  const update = (of: string | null, change: (current: WearWithState) => WearWithState) =>
    setResult((current) =>
      current.id === of ? { id: of, state: change(current.state) } : current,
    );
  // Asking again with the same request (a history entry that timed out) polls it afresh.
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setResult({ id, state: { status: 'pending' } });
    setAttempt((n) => n + 1);
  };

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
            // A live region only speaks on Android; this says the looks arrived on iOS too.
            AccessibilityInfo.announceForAccessibility(
              request.outfits.length > 0
                ? i18n.t('wearWith.ready', { count: request.outfits.length })
                : i18n.t('wearWith.empty'),
            );
            return;
          }
          if (request.status === 'failed') break;
        } catch {
          // A dropped request is no reason to stop; the next poll tries again.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (cancelled) return;
      setResult({ id, state: { status: 'failed' } });
      AccessibilityInfo.announceForAccessibility(i18n.t('wearWith.failed'));
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [id, lang, attempt, i18n]);

  // Shown at once; if the server doesn't take it, it goes back. Built from the current outfits,
  // so two quick taps count twice and reactions to other outfits since then stay.
  async function react(outfit: Outfit, reaction: OutfitReaction) {
    if (state.status !== 'done') return;
    void Haptics.selectionAsync();
    const was = state.outfits.find((o) => o.id === outfit.id)?.opinion ?? null;
    const apply = (change: (o: Outfit) => Outfit) =>
      update(id, (current) =>
        current.status === 'done'
          ? {
              ...current,
              outfits: current.outfits.map((o) => (o.id === outfit.id ? change(o) : o)),
            }
          : current,
      );
    apply((o) =>
      reaction === 'wore'
        ? { ...o, woreCount: o.woreCount + 1 }
        : { ...o, opinion: reaction === 'none' ? null : reaction },
    );
    try {
      await reactToOutfit(outfit.id, reaction);
    } catch {
      apply((o) =>
        reaction === 'wore'
          ? { ...o, woreCount: Math.max(0, o.woreCount - 1) }
          : { ...o, opinion: was },
      );
    }
  }

  // The piece went into the user's wishes.
  const setWishId = (wishId: string) =>
    update(id, (current) => (current.status === 'done' ? { ...current, wishId } : current));

  return { state, react, retry, setWishId };
}
