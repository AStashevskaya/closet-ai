import type { Currency, ItemCategory, ItemColor, LimitCode, Season } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { BrandPriceFields } from '@/components/brand-price-fields';
import { ItemFields, MAX_COLORS } from '@/components/item-fields';
import { PressableScale } from '@/components/pressable-scale';
import { PhotoCropper } from '@/components/photo-cropper';
import { CropButton, RotateButton } from '@/components/rotate-button';
import { ThreadLine } from '@/components/thread-stops';
import { WantMore } from '@/components/want-more';
import { createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText } from '@/lib/limits';
import { defaultCurrency, parsePrice } from '@/lib/price';
import { rotatePhoto, shrinkPhoto } from '@/lib/shrink-photo';
import { useConfirmLeave } from '@/lib/use-confirm-leave';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

// Same pace as the single-item form: the model usually answers in 4–6 s a photo.
const POLL_MS = 1500;
const MAX_POLLS = 20;
// Photos shrunk and uploaded at once; the rest wait their turn.
const PARALLEL_UPLOADS = 3;
// How many photos the band fans out, and where the thread runs from the start edge.
const FAN = 3;
const THREAD_AT = 14;
// The list's start padding: the pieces sit this far in, the thread and its stops in that margin.
const THREAD_PAD = 34;
// The fanned prints: the middle one on top, the others turned out a little behind it.
const fanPlace = (i: number, n: number) => {
  const offset = n === 1 ? 0 : (i - (n - 1) / 2) * 62;
  const turn = n === 1 ? -3 : (i - (n - 1) / 2) * 6;
  return {
    transform: [{ translateX: offset }, { rotate: `${turn}deg` }],
    zIndex: i === Math.floor(n / 2) ? 2 : 1,
  };
};

export type PickedPhoto = { uri: string; width: number; height: number };

// What will be saved for a recognised photo: its tags, as corrected in the list.
// price is the field's text, parsed when saving.
type Draft = {
  name: string;
  category: ItemCategory;
  colors: ItemColor[];
  seasons: Season[];
  brand: string;
  price: string;
  currency: Currency;
};

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

const isComplete = ({ name, colors: itemColors, price }: Draft) =>
  name.trim().length > 0 && itemColors.length > 0 && parsePrice(price) !== undefined;

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
  // The row whose photo is in the cropper.
  const [cropping, setCropping] = useState<number | null>(null);
  // How tall the list is, for the thread down its stops.
  const [threadHeight, setThreadHeight] = useState(0);
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
            brand: tags.brand ?? '',
            price: '',
            currency: defaultCurrency(),
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

  // A crop shows which item is meant, so the cropped photo is uploaded and tagged afresh: its
  // tags replace the row's, as they were read off the whole photo.
  async function cropped(index: number, uri: string) {
    setCropping(null);
    update(index, () => ({ status: 'uploading', uri }));
    await send(index, uri);
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
        const { name, brand, price, currency, ...rest } = entry.draft;
        const paid = parsePrice(price) ?? null;
        return createItem({
          name: name.trim(),
          ...rest,
          photoKey: entry.photoKey,
          brand: brand.trim() || null,
          price: paid,
          currency: paid === null ? null : currency,
        });
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
      {/* The new pieces arriving, on the blue of something new (decided 2026-10-31, prototype
          `~/Desktop/closet/wrinkle-lab/design-adding`, "batch", "Выбрано"): three of the photos
          fanned as prints, and how many are read. */}
      <View style={styles.band}>
        <View
          style={styles.fan}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {entries.slice(0, FAN).map((entry, i, shown) => (
            <View
              key={i}
              style={[
                styles.fanPrint,
                fanPlace(i, shown.length),
                isPending(entry) && styles.printReading,
              ]}
            >
              <Image source={{ uri: entry.uri }} style={styles.fill} contentFit="cover" />
            </View>
          ))}
        </View>
        <Animated.Text
          key={pending > 0 ? 'pending' : 'ready'}
          style={styles.statusText}
          entering={FadeIn.duration(durations.state)}
          exiting={FadeOut.duration(durations.press)}
          accessibilityLiveRegion="polite"
        >
          {pending > 0
            ? t('addItems.progress', { done, count: entries.length })
            : t('addItems.ready')}
        </Animated.Text>
      </View>

      {/* Each piece a stop on one thread; the sign of waiting runs down it while any is read. */}
      <View
        style={styles.thread}
        onLayout={(event) => setThreadHeight(event.nativeEvent.layout.height)}
      >
        <ThreadLine top={0} length={threadHeight} waiting={pending > 0} x={THREAD_AT} />
        {entries.map((entry, index) => {
          const ready = entry.status === 'ready';
          const selected = ready && picked.has(index);
          const expanded = ready && open === index;
          const name = ready ? entry.draft.name : t(`addItems.${entry.status}`);
          const canRotate = (ready && !entry.rotating) || entry.status === 'unknown';
          return (
            <View key={index} style={styles.card}>
              <View style={styles.row}>
                {/* Its stop, beside the row (not the open fields): a bead when it goes to the
                    closet, empty when not, dashed when unread. */}
                <View
                  style={[
                    styles.stop,
                    selected && styles.stopOn,
                    entry.status === 'unknown' && styles.stopUnknown,
                  ]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
                <View>
                  <View
                    style={[
                      styles.print,
                      { transform: [{ rotate: index % 2 ? '1deg' : '-1deg' }] },
                      entry.status === 'unknown' && styles.printUnknown,
                      isPending(entry) && styles.printReading,
                    ]}
                  >
                    <Image source={{ uri: entry.uri }} style={styles.fill} contentFit="cover" />
                  </View>
                  {(canRotate || (ready && entry.rotating)) && (
                    <View style={styles.photoActions}>
                      <CropButton
                        size="small"
                        onPress={() => setCropping(index)}
                        disabled={!canRotate || busy}
                      />
                      <RotateButton
                        size="small"
                        onPress={() => rotate(index)}
                        disabled={!canRotate || busy}
                      />
                    </View>
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
                    <Text style={styles.rowCategory}>
                      {t(`categories.${entry.draft.category}`)}
                    </Text>
                  )}
                </PressableScale>

                {ready ? (
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
                        <Icon name="check" color={colors.onBead} size={14} strokeWidth={2} />
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
                  <BrandPriceFields
                    brand={entry.draft.brand}
                    onBrandChange={(value) => edit(index, { brand: value })}
                    price={entry.draft.price}
                    onPriceChange={(value) => edit(index, { price: value })}
                    currency={entry.draft.currency}
                    onCurrencyChange={(value) => edit(index, { currency: value })}
                  />
                </Animated.View>
              )}
            </View>
          );
        })}
      </View>

      {limit && (
        <>
          <Text style={styles.error} accessibilityRole="alert">
            {limitText(t, i18n.language, limit)}
          </Text>
          <WantMore code={limit} />
        </>
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
        style={[styles.button, styles.gutter, (busy || pending > 0) && styles.buttonBusy]}
        onPress={save}
        disabled={busy || pending > 0}
        accessibilityRole="button"
      >
        {busy ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.buttonText}>{t('addItems.hang', { count: picked.size })}</Text>
        )}
      </PressableScale>

      <PhotoCropper
        uri={cropping === null ? null : (entries[cropping]?.uri ?? null)}
        onCancel={() => setCropping(null)}
        onDone={(uri) => cropping !== null && cropped(cropping, uri)}
      />
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
    paddingBottom: 40,
  },
  gutter: {
    marginHorizontal: 22,
  },
  // The header is on the same blue (see app/_layout.tsx), so the band carries on from it.
  band: {
    backgroundColor: colors.ground,
    paddingTop: 8,
    paddingBottom: 22,
    alignItems: 'center',
    gap: 14,
  },
  fan: {
    height: 128,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fanPrint: {
    position: 'absolute',
    width: 92,
    height: 118,
    padding: 5,
    backgroundColor: colors.paper,
    shadowColor: colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  fill: {
    flex: 1,
    backgroundColor: colors.hero,
  },
  statusText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 22,
  },
  thread: {
    paddingStart: THREAD_PAD,
    paddingEnd: 22,
    paddingTop: 10,
  },
  card: {
    paddingVertical: 10,
  },
  // A stop on the thread, beside the piece.
  stop: {
    position: 'absolute',
    start: THREAD_AT - THREAD_PAD - 5,
    top: '50%',
    width: 10,
    height: 10,
    marginTop: -5,
    borderRadius: 5,
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.background,
  },
  stopOn: {
    backgroundColor: colors.bead,
  },
  stopUnknown: {
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
  },
  row: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  // A piece not in the closet yet: a white-bordered print, a list's prints tilted ±1°.
  print: {
    width: 64,
    height: 84,
    padding: 4,
    backgroundColor: colors.paper,
    shadowColor: colors.text,
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  // Couldn't be read: a dashed empty print, the photo faint inside it.
  printUnknown: {
    borderWidth: 1.2,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    backgroundColor: colors.background,
    shadowOpacity: 0,
    elevation: 0,
  },
  // Still being read: faded; the thread's sign says it waits.
  printReading: {
    opacity: 0.45,
  },
  photoActions: {
    position: 'absolute',
    bottom: 4,
    end: 4,
    flexDirection: 'row',
    gap: 4,
  },
  rowText: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
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
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  editor: {
    paddingTop: 10,
    paddingBottom: 6,
    gap: 10,
  },
  error: {
    marginTop: 8,
    marginHorizontal: 22,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
  button: {
    height: 52,
    marginTop: 18,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bead,
  },
  buttonBusy: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onBead,
  },
});
