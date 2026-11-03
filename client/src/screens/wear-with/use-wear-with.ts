import type { DislikeReason, Outfit, OutfitReaction, WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo } from 'react-native';

import { getWearWith, reactToOutfit } from '@/lib/api';
import { ApiError, isOffline } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';

// The model takes about 10 s; after a minute and a half the screen gives up.
const POLL_MS = 2000;
const MAX_POLLS = 45;
// A blip is no reason to stop, but no connection for this many polls in a row (about 10 s) is: the
// screen says so and offers to try again, rather than waiting out the minute and a half.
const MAX_OFFLINE_POLLS = 5;

export type WearWithState =
  | {
      status: 'pending';
      // The server has answered that it's being composed. Until then (the first load) nothing is
      // known, and a request done long ago may yet come back at once.
      composing: boolean;
      // For an item from a photo, known while it's composed: its name and that it isn't hers yet.
      addable: WearWithRequest['addable'];
    }
  | { status: 'failed'; offline: boolean }
  | {
      status: 'done';
      outfits: Outfit[];
      addable: WearWithRequest['addable'];
      verdict: WearWithRequest['verdict'];
      wishId: string | null;
    };

const FIRST_LOAD: WearWithState = { status: 'pending', composing: false, addable: null };

// A "what do I wear this with?" request: polled until its outfits are composed, with reactions to
// them shown at once. Shared by the outfits screen and Style it. `id` null: nothing asked yet.
export function useWearWith(id: string | null) {
  const { i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  // Kept with the request it belongs to: asking about another piece reads as pending at once,
  // without resetting state in an effect.
  const [result, setResult] = useState<{ id: string | null; state: WearWithState }>({
    id,
    state: FIRST_LOAD,
  });
  const state: WearWithState = result.id === id ? result.state : FIRST_LOAD;
  // Changes the outfits of request `of` only: an answer for a piece the user has since left
  // (a reaction failing late) must not touch the piece now on screen.
  const update = (of: string | null, change: (current: WearWithState) => WearWithState) =>
    setResult((current) =>
      current.id === of ? { id: of, state: change(current.state) } : current,
    );
  // Asking again with the same request (a history entry that timed out) polls it afresh.
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setResult({ id, state: FIRST_LOAD });
    setAttempt((n) => n + 1);
  };

  // Polls the request until its outfits are composed.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const poll = async () => {
      let composing = false;
      let offline = 0;
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const request: WearWithRequest = await getWearWith(id, lang);
          if (cancelled) return;
          offline = 0;
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
          if (!composing) {
            composing = true;
            const { addable } = request;
            setResult({ id, state: { status: 'pending', composing, addable } });
          }
        } catch (cause) {
          // Deleted, say on another phone: asking again won't bring it back.
          if (cause instanceof ApiError && cause.status === 404) break;
          // A dropped request is no reason to stop; the next poll tries again.
          offline = isOffline(cause) ? offline + 1 : 0;
          if (offline === MAX_OFFLINE_POLLS) break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (cancelled) return;
      const gaveUp = offline === MAX_OFFLINE_POLLS;
      setResult({ id, state: { status: 'failed', offline: gaveUp } });
      AccessibilityInfo.announceForAccessibility(
        i18n.t(gaveUp ? 'common.offline' : 'wearWith.failed'),
      );
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [id, lang, attempt, i18n]);

  // The last reaction sent for each outfit: the next one waits for it. "Not mine" and its reason
  // go one after the other, and the server keeps the latest, so a reason that overtook its dislike
  // would be lost (senior-qa, 2026-10-29).
  const sending = useRef(new Map<string, Promise<void>>());

  // Shown at once; if the server doesn't take it, it goes back. Built from the current outfits,
  // so two quick taps count twice and reactions to other outfits since then stay.
  function react(outfit: Outfit, reaction: OutfitReaction, reason?: DislikeReason) {
    if (state.status !== 'done') return;
    void Haptics.selectionAsync();
    const before = state.outfits.find((o) => o.id === outfit.id);
    const was = { opinion: before?.opinion ?? null, reason: before?.reason ?? null };
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
        : // A new opinion has no reason until she gives one.
          { ...o, opinion: reaction === 'none' ? null : reaction, reason: reason ?? null },
    );
    const send = async () => {
      try {
        await (reason
          ? reactToOutfit(outfit.id, reaction, reason)
          : reactToOutfit(outfit.id, reaction));
      } catch {
        apply((o) =>
          reaction === 'wore'
            ? { ...o, woreCount: Math.max(0, o.woreCount - 1) }
            : { ...o, ...was },
        );
      }
    };
    // `send` never rejects, so one failed reaction doesn't stop the ones after it.
    const sent = (sending.current.get(outfit.id) ?? Promise.resolve()).then(send);
    sending.current.set(outfit.id, sent);
  }

  // The piece went into the user's wishes.
  const setWishId = (wishId: string) =>
    update(id, (current) => (current.status === 'done' ? { ...current, wishId } : current));

  return { state, react, retry, setWishId };
}
