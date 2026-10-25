import type { StyleState } from '@closet-ai/shared';
import { useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

import { getStyle, refreshStyle } from './api';
import { appLanguage } from './app-language';

// A brief takes a few minutes through the Batch API; checked this often, for at most 10 minutes.
export const STYLE_POLL_MS = 30_000;
export const MAX_STYLE_POLLS = 20;
// "Not now" on the card hides it until tomorrow (the phone's day).
const DISMISSED_KEY = 'closet.shoppingDismissed';
const today = () => new Date().toDateString();

function dismissedOn() {
  try {
    return SecureStore.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export type StyleCardState = ReturnType<typeof useStyle>;

// Her style for the "great shopping" card, held by the closet screen so the card can come and
// go (filters, edit mode) without losing an update in progress. Loaded when the screen comes
// into view, asked to update, and watched until the new one is back. null until it loads (or
// if it fails: the card is a nicety, the closet works without it).
export function useStyle(language: string) {
  const lang = appLanguage(language);
  const [style, setStyle] = useState<StyleState | null>(null);
  const [dismissed, setDismissed] = useState(dismissedOn);
  // When she asks: the writtenAt of the brief then, to tell when a newer one is back.
  const [writtenBefore, setWrittenBefore] = useState<string | null>(null);
  // Checks made since she asked; counted in state so a failed check still schedules the next.
  const [polls, setPolls] = useState(0);

  const load = useCallback(async () => {
    try {
      setStyle(await getStyle(lang));
    } catch {
      // As above.
    }
  }, [lang]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const asked = writtenBefore !== null;
  const watching = asked && style?.updating === true && polls < MAX_STYLE_POLLS;
  useEffect(() => {
    if (!watching) return;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      void load();
    }, STYLE_POLL_MS);
    return () => clearTimeout(timer);
  }, [watching, polls, load]);

  const update = useCallback(async () => {
    const before = style?.writtenAt ?? '';
    // Throws for a limit or a refusal; the card says why.
    const next = await refreshStyle(lang);
    setPolls(0);
    setWrittenBefore(before);
    setStyle(next);
  }, [lang, style]);

  const dismiss = useCallback(async () => {
    const day = today();
    setDismissed(day);
    try {
      await SecureStore.setItemAsync(DISMISSED_KEY, day);
    } catch {
      // Hidden for this session at least.
    }
  }, []);

  // Seen the outcome: back to a closet without the card.
  const done = useCallback(() => setWrittenBefore(null), []);

  const updated = asked && style !== null && !style.updating && style.writtenAt !== writtenBefore;
  return {
    style,
    // Compared with today on every render: the tab stays mounted past midnight.
    dismissed: dismissed === today(),
    asked,
    updated,
    // Still being written after every check: it may yet come, later.
    slow: asked && style?.updating === true && polls >= MAX_STYLE_POLLS,
    load,
    update,
    dismiss,
    done,
  };
}
