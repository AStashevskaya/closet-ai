import type { ItemTags } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

// Same pace as the single-item form: the model usually answers in 4–6 s a photo.
const POLL_MS = 1500;
const MAX_POLLS = 20;
// Photos shrunk and uploaded at once; the rest wait their turn.
const PARALLEL_UPLOADS = 3;
const MAX_COLORS = 5;

export type PickedPhoto = { uri: string; width: number; height: number };

// One picked photo on its way to becoming an item.
type Entry =
  | { status: 'uploading'; uri: string }
  | { status: 'tagging'; uri: string; photoKey: string }
  | { status: 'ready'; uri: string; photoKey: string; tags: ItemTags }
  // Uploaded, but the model saw no single item (or gave up): it needs the one-item form.
  | { status: 'unknown'; uri: string }
  | { status: 'failed'; uri: string }
  // Already in the closet: left in the list after a save that failed for some of the others.
  | { status: 'added'; uri: string };

// The add-item form passes the gallery picks as JSON in the route params.
function parsePhotos(param: string | undefined): PickedPhoto[] {
  try {
    const value: unknown = JSON.parse(param ?? '[]');
    return Array.isArray(value) ? (value as PickedPhoto[]) : [];
  } catch {
    return [];
  }
}

const isPending = (entry: Entry) => entry.status === 'uploading' || entry.status === 'tagging';

// Several photos from the gallery at once, one item each: every photo is uploaded and tagged
// like in the single-item form, then the recognised ones are added with their tags as they
// are. Names and colours can be corrected on each item afterwards.
export function AddItems() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const params = useLocalSearchParams<{ photos?: string }>();
  // Read once: the list doesn't change while the screen is open.
  const [photos] = useState(() => parsePhotos(params.photos));
  const [entries, setEntries] = useState<Entry[]>(() =>
    photos.map(({ uri }) => ({ status: 'uploading', uri })),
  );
  // Indexes of the recognised photos to add; each is ticked once it is recognised.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<'addItems.errors.save' | 'addLook.errors.empty' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const update = (index: number, entry: Entry) => {
      if (!cancelled) setEntries((current) => current.map((e, i) => (i === index ? entry : e)));
    };

    async function tag(index: number, uri: string, photoKey: string) {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const state = await getPhotoState(photoKey);
          if (cancelled) return;
          const { tags } = state;
          if (state.tagStatus === 'done' && tags?.recognized && tags.colors.length > 0) {
            update(index, { status: 'ready', uri, photoKey, tags });
            setPicked((current) => new Set(current).add(index));
            return;
          }
          if (state.status === 'failed' || state.tagStatus !== 'pending') break;
        } catch {
          // A dropped request is no reason to stop; the next poll tries again.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      update(index, { status: 'unknown', uri });
    }

    async function process(index: number) {
      const photo = photos[index]!;
      let uri = photo.uri;
      try {
        uri = await shrinkPhoto(photo);
        if (cancelled) return;
        const photoKey = await uploadPhoto(uri, lang);
        update(index, { status: 'tagging', uri, photoKey });
        // Tagging runs on the server, so the next upload can start meanwhile.
        void tag(index, uri, photoKey);
      } catch (cause) {
        if (__DEV__) console.warn('Uploading a photo failed', cause);
        update(index, { status: 'failed', uri });
      }
    }

    // A few workers take the photos in order, so a long list doesn't start 20 uploads at once.
    let next = 0;
    const worker = async () => {
      while (!cancelled && next < photos.length) await process(next++);
    };
    for (let i = 0; i < Math.min(PARALLEL_UPLOADS, photos.length); i++) void worker();

    return () => {
      cancelled = true;
    };
    // Runs once for the photos the screen was opened with; the language doesn't change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = entries.filter(isPending).length;
  const done = entries.length - pending;

  function toggle(index: number) {
    void Haptics.selectionAsync();
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function save() {
    if (picked.size === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return setError('addLook.errors.empty');
    }
    setError(null);
    setBusy(true);
    const indexes = [...picked].sort((a, b) => a - b);
    const results = await Promise.allSettled(
      indexes.map((index) => {
        const entry = entries[index];
        if (entry?.status !== 'ready') return Promise.reject(new Error('not recognised'));
        const { name, category, colors: itemColors, seasons } = entry.tags;
        return createItem({
          name,
          category,
          colors: itemColors.slice(0, MAX_COLORS),
          seasons,
          photoKey: entry.photoKey,
        });
      }),
    );
    const failed = new Set(indexes.filter((_, i) => results[i]!.status === 'rejected'));
    if (failed.size === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      return;
    }
    // The ones that were added leave the selection, so "try again" only sends the rest.
    if (__DEV__) console.warn('Adding some items failed', results);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setPicked(failed);
    setEntries((current) =>
      current.map((entry, index) =>
        indexes.includes(index) && !failed.has(index) ? { status: 'added', uri: entry.uri } : entry,
      ),
    );
    setError('addItems.errors.save');
    setBusy(false);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View
        key={pending > 0 ? 'pending' : 'ready'}
        style={styles.status}
        entering={FadeIn.duration(durations.state)}
        exiting={FadeOut.duration(durations.press)}
        accessibilityLiveRegion="polite"
      >
        {pending > 0 && <ActivityIndicator size="small" color={colors.accent} />}
        <Text style={styles.statusText}>
          {pending > 0
            ? t('addItems.progress', { done, count: entries.length })
            : t('addItems.ready')}
        </Text>
      </Animated.View>

      {entries.map((entry, index) => {
        const ready = entry.status === 'ready';
        const selected = ready && picked.has(index);
        const name = ready ? entry.tags.name : t(`addItems.${entry.status}`);
        return (
          <PressableScale
            key={index}
            style={[styles.row, selected && styles.rowSelected, !ready && styles.rowIdle]}
            onPress={ready ? () => toggle(index) : undefined}
            disabled={!ready || busy}
            accessibilityRole={ready ? 'checkbox' : undefined}
            accessibilityState={ready ? { checked: selected } : undefined}
            accessibilityLabel={name}
          >
            <Image source={{ uri: entry.uri }} style={styles.thumb} contentFit="cover" />
            <View style={styles.rowText}>
              <Text style={ready ? styles.rowName : styles.rowNote} numberOfLines={2}>
                {name}
              </Text>
              {ready && (
                <Text style={styles.rowCategory}>{t(`categories.${entry.tags.category}`)}</Text>
              )}
            </View>
            {isPending(entry) ? (
              <ActivityIndicator size="small" color={colors.iconMuted} />
            ) : ready ? (
              <Animated.View
                style={[
                  styles.check,
                  selected && styles.checkSelected,
                  { transitionProperty: ['backgroundColor', 'borderColor'] },
                  { transitionDuration: durations.state, transitionTimingFunction: CSS_EASE_OUT },
                ]}
              >
                {selected && (
                  <Icon name="check" color={colors.onAccent} size={14} strokeWidth={2} />
                )}
              </Animated.View>
            ) : null}
          </PressableScale>
        );
      })}

      {error && (
        <Animated.Text
          key={error}
          style={styles.error}
          entering={FadeIn.duration(durations.state)}
          exiting={FadeOut.duration(durations.press)}
          accessibilityRole="alert"
        >
          {t(error)}
        </Animated.Text>
      )}

      {/* Waits for every photo, so nothing still being recognised is left behind. */}
      <PressableScale
        style={[styles.button, (busy || pending > 0) && styles.buttonBusy]}
        onPress={save}
        disabled={busy || pending > 0}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.buttonText}>{t('addLook.add', { count: picked.size })}</Text>
        )}
      </PressableScale>
    </ScrollView>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 22,
    paddingBottom: 40,
    gap: 10,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 24,
    marginBottom: 4,
  },
  statusText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  rowIdle: {
    borderStyle: 'dashed',
  },
  thumb: {
    width: 64,
    height: 84,
    borderRadius: 12,
    backgroundColor: colors.hero,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  rowNote: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'left',
  },
  rowCategory: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'left',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  error: {
    marginTop: 8,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
  button: {
    height: 52,
    marginTop: 12,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonBusy: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
});
