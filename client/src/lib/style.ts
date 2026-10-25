import type { StyleState } from '@closet-ai/shared';
import { useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getStyle, refreshStyle } from './api';
import { appLanguage } from './app-language';

// A brief takes a few minutes through the Batch API; checked this often, for at most 10 minutes.
export const STYLE_POLL_MS = 30_000;
const MAX_POLLS = 20;
// "Not now" on the card hides it until tomorrow (the phone's day).
const DISMISSED_KEY = 'closet.shoppingDismissed';
const today = () => new Date().toDateString();

function dismissedToday() {
  try {
    return SecureStore.getItem(DISMISSED_KEY) === today();
  } catch {
    return false;
  }
}

// Her style for the "great shopping" card: loaded when the screen comes into view, asked to
// update, and watched until the new one is back. null until it loads (or if it fails: the
// card is a nicety, the closet works without it).
export function useStyle(language: string) {
  const lang = appLanguage(language);
  const [style, setStyle] = useState<StyleState | null>(null);
  const [dismissed, setDismissed] = useState(dismissedToday);
  // Set when she asks: the summary to show once the brief written since then is back.
  const [asked, setAsked] = useState<string | null>(null);
  const polls = useRef(0);

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

  useEffect(() => {
    if (!style?.updating || polls.current >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void load();
    }, STYLE_POLL_MS);
    return () => clearTimeout(timer);
  }, [style, load]);

  const update = useCallback(async () => {
    const asking = style?.writtenAt ?? '';
    // Throws for a limit or a refusal; the screen says why.
    const next = await refreshStyle(lang);
    polls.current = 0;
    setAsked(asking);
    setStyle(next);
  }, [lang, style]);

  const dismiss = useCallback(async () => {
    setDismissed(true);
    try {
      await SecureStore.setItemAsync(DISMISSED_KEY, today());
    } catch {
      // Hidden for this session at least.
    }
  }, []);

  // Seen the new summary: back to a closet without the card.
  const done = useCallback(() => setAsked(null), []);

  const updated = asked !== null && style !== null && !style.updating && style.writtenAt !== asked;
  return { style, dismissed, asked: asked !== null, updated, update, dismiss, done };
}
