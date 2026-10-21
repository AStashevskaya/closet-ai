import type { ItemCategory, ItemColor, LimitCode, Season } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { ItemFields, MAX_COLORS } from '@/components/item-fields';
import { HangerLoader } from '@/components/hanger-loader';
import { PressableScale } from '@/components/pressable-scale';
import { RotateButton } from '@/components/rotate-button';
import { createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText } from '@/lib/limits';
import { rotatePhoto, shrinkPhoto } from '@/lib/shrink-photo';
import { useConfirmLeave } from '@/lib/use-confirm-leave';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

// Same pace as the single-item form: the model usually answers in 4–6 s a photo.
const POLL_MS = 1500;
const MAX_POLLS = 20;
// Photos shrunk and uploaded at once; the rest wait their turn.
const PARALLEL_UPLOADS = 3;

export type PickedPhoto = { uri: string; width: number; height: number };

// What will be saved for a recognised photo: its tags, as corrected in the list.
type Draft = { name: string; category: ItemCategory; colors: ItemColor[]; seasons: Season[] };

// One picked photo on its way to becoming an item.
type Entry =
  | { status: 'uploading'; uri: string }
  | { status: 'tagging'; uri: string; photoKey: string }
  // `rotating`: a turned copy is being uploaded in place of photoKey.
  | { status: 'ready'; uri: string; photoKey: string; draft: Draft; rotating: boolean }
  // Uploaded, but the model saw no single item (or gave up): turning the photo tries again.
  | { status: 'unknown'; uri: string }
  | { status: 'failed'; uri: string }
  // Already in the closet: left in the list after a save that failed for some of the others.
  | { status: 'added'; uri: string };

type ErrorKey = 'addItems.errors.save' | 'addItems.errors.incomplete' | 'addLook.errors.empty';

// The add-item form passes the gallery picks as JSON in the route params.
function parsePhotos(param: string | undefined): PickedPhoto[] {
  try {
    const value: unknown = JSON.parse(param ?? '[]');
    return Array.isArray(value) ? (value as PickedPhoto[]) : [];
  } catch {
    return [];
  }
}

const isPending = (entry: Entry) =>
  entry.status === 'uploading' ||
  entry.status === 'tagging' ||
  (entry.status === 'ready' && entry.rotating);

const isComplete = ({ name, colors: itemColors }: Draft) =>
  name.trim().length > 0 && itemColors.length > 0;

// Several photos from the gallery at once, one item each: every photo is uploaded and tagged
// like in the single-item form, the recognised ones are ticked with their tags, and each row
// opens to correct its name, category and colours, or turns its photo.
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
  // The row open for editing, if any.
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  // A limit an upload or a save ran into: shown instead of the generic error.
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const pending = entries.filter(isPending).length;
  const done = entries.length - pending;
  // Recognised or still on their way: what a swipe down would throw away.
  const leave = useConfirmLeave(entries.some((e) => isPending(e) || e.status === 'ready'));
  // Uploads and polls outlive renders; they stop touching state once the screen is gone.
  const closed = useRef(false);

  function update(index: number, change: (entry: Entry) => Entry) {
    if (closed.current) return;
    setEntries((current) => current.map((entry, i) => (i === index ? change(entry) : entry)));
  }

  async function tag(index: number, uri: string, photoKey: string) {
    for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
      try {
        const state = await getPhotoState(photoKey);
        if (closed.current) return;
        const { tags } = state;
        if (state.tagStatus === 'done' && tags?.recognized) {
          const draft: Draft = {
            name: tags.name,
            category: tags.category,
            colors: tags.colors.slice(0, MAX_COLORS),
            seasons: tags.seasons,
          };
          update(index, () => ({ status: 'ready', uri, photoKey, draft, rotating: false }));
          setPicked((current) => new Set(current).add(index));
          return;
        }
        if (state.status === 'failed' || state.tagStatus !== 'pending') break;
      } catch {
        // A dropped request is no reason to stop; the next poll tries again.
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (closed.current) return;
    }
    update(index, () => ({ status: 'unknown', uri }));
  }

  // Uploads a shrunk photo and has it tagged. Tagging runs on the server, so the caller can
  // start the next upload meanwhile.
  async function send(index: number, uri: string) {
    try {
      const photoKey = await uploadPhoto(uri, lang);
      update(index, () => ({ status: 'tagging', uri, photoKey }));
      void tag(index, uri, photoKey);
    } catch (cause) {
      const code = limitReached(cause);
      if (code) setLimit(code);
      else if (__DEV__) console.warn('Uploading a photo failed', cause);
      update(index, () => ({ status: 'failed', uri }));
    }
  }

  useEffect(() => {
    closed.current = false;
    // A few workers take the photos in order, so a long list doesn't start 20 uploads at once.
    let next = 0;
    const worker = async () => {
      while (!closed.current && next < photos.length) {
        const index = next++;
        const photo = photos[index]!;
        let uri = photo.uri;
        try {
          uri = await shrinkPhoto(photo);
        } catch (cause) {
          if (__DEV__) console.warn('Shrinking a photo failed', cause);
          update(index, () => ({ status: 'failed', uri }));
          continue;
        }
        await send(index, uri);
      }
    };
    for (let i = 0; i < Math.min(PARALLEL_UPLOADS, photos.length); i++) void worker();

    return () => {
      closed.current = true;
    };
    // Runs once for the photos the screen was opened with; the language doesn't change meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A quarter turn clockwise. A recognised photo keeps its fields and only the turned copy is
  // uploaded; an unrecognised one is tagged again, since a sideways photo may be why.
  async function rotate(index: number) {
    const entry = entries[index];
    if (entry?.status !== 'ready' && entry?.status !== 'unknown') return;
    if (entry.status === 'ready') {
      update(index, (e) => (e.status === 'ready' ? { ...e, rotating: true } : e));
    }
    if (entry.status === 'unknown') update(index, () => ({ status: 'uploading', uri: entry.uri }));

    let uri: string;
    try {
      uri = await rotatePhoto(entry.uri);
    } catch (cause) {
      if (__DEV__) console.warn('Rotating a photo failed', cause);
      update(index, () => entry);
      return;
    }
    if (entry.status === 'unknown') return send(index, uri);

    update(index, (e) => ({ ...e, uri }));
    try {
      const photoKey = await uploadPhoto(uri, lang);
      update(index, (e) => (e.status === 'ready' ? { ...e, photoKey, rotating: false } : e));
    } catch (cause) {
      // The old upload is still there, so the item can be saved; only the turn is lost.
      if (__DEV__) console.warn('Uploading a turned photo failed', cause);
      update(index, (e) => (e.status === 'ready' ? { ...e, uri: entry.uri, rotating: false } : e));
    }
  }

  function edit(index: number, change: Partial<Draft>) {
    update(index, (e) => (e.status === 'ready' ? { ...e, draft: { ...e.draft, ...change } } : e));
  }

  function toggle(index: number) {
    void Haptics.selectionAsync();
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function fail(key: ErrorKey) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setError(key);
  }

  async function save() {
    if (picked.size === 0) return fail('addLook.errors.empty');
    const indexes = [...picked].sort((a, b) => a - b);
    const incomplete = indexes.find((index) => {
      const entry = entries[index];
      return entry?.status === 'ready' && !isComplete(entry.draft);
    });
    if (incomplete !== undefined) {
      setOpen(incomplete);
      return fail('addItems.errors.incomplete');
    }

    setError(null);
    setBusy(true);
    const results = await Promise.allSettled(
      indexes.map((index) => {
        const entry = entries[index];
        if (entry?.status !== 'ready') return Promise.reject(new Error('not recognised'));
        const { name, ...rest } = entry.draft;
        return createItem({ name: name.trim(), ...rest, photoKey: entry.photoKey });
      }),
    );
    const failed = new Set(indexes.filter((_, i) => results[i]!.status === 'rejected'));
    const limited = results.flatMap((r) =>
      r.status === 'rejected' ? [limitReached(r.reason)] : [],
    );
    const code = limited.find((c) => c !== null) ?? null;
    if (failed.size === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      leave(() => router.back());
      return;
    }
    // The ones that were added leave the selection, so "try again" only sends the rest.
    if (__DEV__) console.warn('Adding some items failed', results);
    setPicked(failed);
    setOpen(null);
    setEntries((current) =>
      current.map((entry, index) =>
        indexes.includes(index) && !failed.has(index) ? { status: 'added', uri: entry.uri } : entry,
      ),
    );
    if (code) {
      setLimit(code);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else fail('addItems.errors.save');
    setBusy(false);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      // iOS insets the scroll view by the keyboard and keeps the focused field above it.
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
    >
      <Animated.View
        key={pending > 0 ? 'pending' : 'ready'}
        style={styles.status}
        entering={FadeIn.duration(durations.state)}
        exiting={FadeOut.duration(durations.press)}
        accessibilityLiveRegion="polite"
      >
        {pending > 0 && <HangerLoader size="small" />}
        <Text style={styles.statusText}>
          {pending > 0
            ? t('addItems.progress', { done, count: entries.length })
            : t('addItems.ready')}
        </Text>
      </Animated.View>

      {entries.map((entry, index) => {
        const ready = entry.status === 'ready';
        const selected = ready && picked.has(index);
        const expanded = ready && open === index;
        const name = ready ? entry.draft.name : t(`addItems.${entry.status}`);
        const canRotate = (ready && !entry.rotating) || entry.status === 'unknown';
        return (
          <View
            key={index}
            style={[styles.card, selected && styles.cardSelected, !ready && styles.cardIdle]}
          >
            <View style={styles.row}>
              <View>
                <Image source={{ uri: entry.uri }} style={styles.thumb} contentFit="cover" />
                {(canRotate || (ready && entry.rotating)) && (
                  <RotateButton
                    size="small"
                    onPress={() => rotate(index)}
                    disabled={!canRotate || busy}
                    style={styles.rotate}
                  />
                )}
              </View>

              <PressableScale
                style={styles.rowText}
                onPress={ready ? () => setOpen(expanded ? null : index) : undefined}
                disabled={!ready || busy}
                accessibilityRole={ready ? 'button' : undefined}
                accessibilityState={ready ? { expanded } : undefined}
                accessibilityLabel={ready ? t('addItems.edit', { name }) : name}
              >
                <Text
                  style={ready && name.trim() ? styles.rowName : styles.rowNote}
                  numberOfLines={2}
                >
                  {ready && !name.trim() ? t('addItem.namePlaceholder') : name}
                </Text>
                {ready && (
                  <Text style={styles.rowCategory}>{t(`categories.${entry.draft.category}`)}</Text>
                )}
              </PressableScale>

              {isPending(entry) ? (
                <ActivityIndicator size="small" color={colors.iconMuted} />
              ) : ready ? (
                <PressableScale
                  onPress={() => toggle(index)}
                  disabled={busy}
                  hitSlop={12}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={name}
                >
                  <Animated.View
                    style={[
                      styles.check,
                      selected && styles.checkSelected,
                      { transitionProperty: ['backgroundColor', 'borderColor'] },
                      {
                        transitionDuration: durations.state,
                        transitionTimingFunction: CSS_EASE_OUT,
                      },
                    ]}
                  >
                    {selected && (
                      <Icon name="check" color={colors.onAccent} size={14} strokeWidth={2} />
                    )}
                  </Animated.View>
                </PressableScale>
              ) : null}
            </View>

            {expanded && (
              <Animated.View
                style={styles.editor}
                entering={FadeIn.duration(durations.state)}
                exiting={FadeOut.duration(durations.press)}
              >
                <ItemFields
                  name={entry.draft.name}
                  onNameChange={(value) => edit(index, { name: value })}
                  category={entry.draft.category}
                  onCategoryChange={(value) => edit(index, { category: value })}
                  itemColors={entry.draft.colors}
                  onColorsChange={(value) => edit(index, { colors: value })}
                />
              </Animated.View>
            )}
          </View>
        );
      })}

      {limit && (
        <Text style={styles.error} accessibilityRole="alert">
          {limitText(t, i18n.language, limit)}
        </Text>
      )}

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

      {/* Waits for every photo, so nothing still being recognised or turned is left behind. */}
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
  card: {
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  cardIdle: {
    borderStyle: 'dashed',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  thumb: {
    width: 64,
    height: 84,
    borderRadius: 12,
    backgroundColor: colors.hero,
  },
  rotate: {
    position: 'absolute',
    bottom: 4,
    end: 4,
  },
  rowText: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
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
  editor: {
    paddingTop: 4,
    paddingBottom: 6,
    gap: 10,
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
