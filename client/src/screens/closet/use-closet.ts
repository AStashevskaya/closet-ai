import type { Item } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { deleteItem, listItems, sessionHeaders } from '@/lib/api';
import { durations } from '@/motion';

const PHOTO_POLL_MS = 1500;
// The cut-out follows a few seconds after the photo. A new item without one is checked again
// for this long; after that removal is off or failed, and the photo stays as it is.
const CUTOUT_WAIT_MS = 20_000;

export type ClosetState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: Item[] };

// The user's items, shared by the closet and a category's "See all" screen: loaded whenever the
// screen comes into view, checked again while new photos are processed, and deleted after asking.
export function useCloset() {
  const { t } = useTranslation();
  const [state, setState] = useState<ClosetState>({ status: 'loading' });
  // Photos are served by the API to their owner only, so the image requests carry the session cookie.
  const [headers, setHeaders] = useState<Record<string, string>>();
  // The server confirmed the delete; the piece fades out before it leaves the list.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const items = await listItems();
      setState({ status: 'ready', items });
    } catch {
      // A failed reload keeps the closet already shown; only a first load shows the error.
      setState((current) => (current.status === 'ready' ? current : { status: 'error' }));
    }
  }, []);

  // Reload whenever the screen comes into view, e.g. after adding an item.
  // The callback may only return a cleanup function, not a promise.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const loadHeaders = async () => {
      try {
        setHeaders(await sessionHeaders());
      } catch {
        setHeaders({});
      }
    };
    void loadHeaders();
  }, []);

  // The server shrinks new photos in the background, usually within a second or two, then
  // removes their background. While any is still processing, or a new one has no cut-out yet,
  // check again shortly; each load schedules the next one.
  useEffect(() => {
    const now = Date.now();
    const waiting =
      state.status === 'ready' &&
      state.items.some(
        (item) =>
          item.photoStatus === 'processing' ||
          (item.photoStatus === 'ready' &&
            !item.cutoutUrl &&
            now - Date.parse(item.createdAt) < CUTOUT_WAIT_MS),
      );
    if (!waiting) return;
    const timer = setTimeout(() => void load(), PHOTO_POLL_MS);
    return () => clearTimeout(timer);
  }, [state, load]);

  const retry = () => {
    setState({ status: 'loading' });
    void load();
  };

  // The piece disappears once the server confirms, so a failed delete never hides an item.
  // It fades out first and only then leaves the list.
  const remove = async (id: string) => {
    try {
      await deleteItem(id);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setLeaving((current) => new Set(current).add(id));
      setTimeout(() => {
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', items: current.items.filter((item) => item.id !== id) }
            : current,
        );
        setLeaving((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, durations.leave);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('closet.deleteError'));
    }
  };

  const confirmDelete = (item: Item) => {
    Alert.alert(t('closet.deleteTitle', { name: item.name }), t('closet.deleteMessage'), [
      { text: t('closet.cancel'), style: 'cancel' },
      { text: t('closet.delete'), style: 'destructive', onPress: () => void remove(item.id) },
    ]);
  };

  return {
    state,
    items: state.status === 'ready' ? state.items : [],
    headers,
    leaving,
    retry,
    confirmDelete,
  };
}
