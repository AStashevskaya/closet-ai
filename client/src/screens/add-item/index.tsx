import {
  ITEM_CATEGORIES,
  type Currency,
  type Item,
  type ItemCategory,
  type ItemColor,
  type LimitCode,
  type Season,
} from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandPriceFields } from '@/components/brand-price-fields';
import { Chip } from '@/components/chip';
import { cutoutShadow } from '@/components/cutout-shadow';
import { Icon } from '@/components/icon';
import { MAX_COLORS } from '@/components/item-fields';
import { Button, maison } from '@/components/maison';
import { PhotoCropper } from '@/components/photo-cropper';
import { PressableScale } from '@/components/pressable-scale';
import { askWearWith, createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText } from '@/lib/limits';
import { defaultCurrency, parsePrice } from '@/lib/price';
import { rotatePhoto, shrinkPhoto } from '@/lib/shrink-photo';
import { styledParams } from '@/lib/styled';
import { useConfirmLeave } from '@/lib/use-confirm-leave';
import { durations, rise, STAGGER_STEP } from '@/motion';
import type { PickedPhoto } from '@/screens/add-items';
import { colors, fonts } from '@/theme';

import { ColorSwatches } from './color-swatches';
import { FieldThread, RailStop, Stop } from './field-thread';
import { HangUp, measureBox, type Box } from './hang-up';
import { DISSOLVE_MS, PhotoBand } from './photo-band';
import { pause, waitForCutout, type Cutout } from './wait-for-cutout';

// Photos picked at once from the gallery.
const MAX_PHOTOS = 20;
// How often the form asks whether the photo has been tagged, and for how long. The model
// usually answers in 4–6 s; after half a minute the form simply stays as the user typed it.
const POLL_MS = 1500;
const MAX_POLLS = 20;

// idle: nothing to show; waiting: the model is looking at the photo; filled: fields came from it.
type Tagging = 'idle' | 'waiting' | 'filled';

type ErrorKey =
  | 'addItem.errors.photo'
  | 'addItem.errors.name'
  | 'addItem.errors.category'
  | 'addItem.errors.colors'
  | 'addItem.errors.price'
  | 'addItem.errors.cameraPermission'
  | 'addItem.errors.unreadable'
  | 'addItem.errors.save';

export function AddItem() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  // A local JPEG, already shrunk for upload.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  // The photo goes up as soon as it is picked, so the server can tag it while the form is
  // filled in. Saving waits for this upload instead of starting another.
  const upload = useRef<Promise<string> | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [tagging, setTagging] = useState<Tagging>('idle');
  // Not in the form: they come from the photo's tags and can be corrected on the item later.
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory | null>(null);
  const [itemColors, setItemColors] = useState<ItemColor[]>([]);
  // Fields the user changed by hand: a crop refills the others from the cropped photo's tags.
  const edited = useRef({ name: false, category: false, colors: false, brand: false });
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  // The photo in the cropper while it is open.
  const [cropping, setCropping] = useState<string | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  // A limit the save ran into (the day's photos, or the server's daily stop).
  const [limit, setLimit] = useState<LimitCode | null>(null);
  // Brand and price stay folded behind "+ add" until she opens them or the photo shows a brand.
  const [brandOpen, setBrandOpen] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  // The photo inside the print, where "Hang it up" starts.
  const picture = useRef<ComponentRef<typeof View>>(null);
  // Saved: the screen waits a moment for the piece's cut-out (the bead runs down the thread), then
  // the piece flies to its rail and the sheet closes.
  const [saved, setSaved] = useState(false);
  const [hanging, setHanging] = useState<{
    from: Box | null;
    category: ItemCategory;
    // The bare piece, or null to fly the photo.
    cutout: Cutout | null;
  } | null>(null);
  // The cut-out on the band's print, once it's made (only after saving: the photo's status
  // before then doesn't say whether it has one).
  const [bandCutout, setBandCutout] = useState<Cutout | null>(null);
  const reduceMotion = useReducedMotion();
  // Stops waiting for the cut-out when the sheet closes.
  // Made in the effect, so a remount (or Fast Refresh) starts with a fresh one, not an aborted one.
  const closing = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    closing.current = controller;
    return () => controller.abort();
  }, []);
  const insets = useSafeAreaInsets();
  // Where the screen starts in the window, for the keyboard (see KeyboardAvoidingView below).
  const root = useRef<ComponentRef<typeof View>>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  // A picked photo or a typed name is worth asking about before the sheet closes; once the piece
  // is saved, a swipe down just closes it.
  const leave = useConfirmLeave(!saved && (photoUri !== null || name.trim() !== ''));

  async function pick(source: 'camera' | 'library') {
    if (source === 'camera') {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) return setError('addItem.errors.cameraPermission');
    }
    // The gallery opens the system photo picker, which needs no permission.
    const launch =
      source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    // Before a photo is in the form, the gallery takes several: one item each, on their own screen.
    const several = source === 'library' && !photoUri;
    const result = await launch({
      mediaTypes: ['images'],
      allowsMultipleSelection: several,
      selectionLimit: several ? MAX_PHOTOS : 1,
      orderedSelection: several,
    });
    if (!result.canceled && result.assets.length > 1) {
      const photos: PickedPhoto[] = result.assets.map(({ uri, width, height }) => ({
        uri,
        width,
        height,
      }));
      leave(() =>
        router.replace({ pathname: '/add-items', params: { photos: JSON.stringify(photos) } }),
      );
      return;
    }
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;

    // The photo and "recognizing" show at once: shrinking a 12 MP HEIC and uploading it take a
    // second or two, which read as a freeze after the gallery closed.
    const previous = { uri: photoUri, key: photoKey, tagging };
    setPhotoUri(asset.uri);
    // The old photo's tags mustn't land on the new one while it's shrunk.
    setPhotoKey(null);
    setError(null);
    setTagging('waiting');
    setBusy(true);
    let uri: string;
    try {
      uri = await shrinkPhoto(asset);
      setPhotoUri(uri);
    } catch (cause) {
      // Back to the photo she had, if any.
      setPhotoUri(previous.uri);
      setPhotoKey(previous.key);
      setTagging(previous.uri ? previous.tagging : 'idle');
      if (__DEV__) console.warn('Shrinking the photo failed', cause);
      setError('addItem.errors.unreadable');
      return;
    } finally {
      setBusy(false);
    }
    await startUpload(uri);
  }

  // A quarter turn clockwise, then the turned photo goes up in place of the old one (which the
  // server's cleanup removes). Fields already filled in stay as they are.
  async function rotate() {
    if (!photoUri) return;
    setBusy(true);
    let uri: string;
    try {
      uri = await rotatePhoto(photoUri);
      setPhotoUri(uri);
    } catch (cause) {
      if (__DEV__) console.warn('Rotating the photo failed', cause);
      return;
    } finally {
      setBusy(false);
    }
    await startUpload(uri);
  }

  // A crop shows the app which item is meant, so the tags filled in from the whole photo are
  // dropped and the cropped photo's fill them again; what the user typed or picked stays.
  async function cropped(uri: string) {
    setCropping(null);
    setPhotoUri(uri);
    if (!edited.current.name) setName('');
    if (!edited.current.brand) setBrand('');
    if (!edited.current.category) setCategory(null);
    if (!edited.current.colors) setItemColors([]);
    setSeasons([]);
    await startUpload(uri);
  }

  async function startUpload(uri: string) {
    setPhotoKey(null);
    // Recognizing starts with the upload, as far as she can tell.
    setTagging('waiting');
    const started = uploadPhoto(uri, lang);
    upload.current = started;
    try {
      const key = await started;
      // A newer photo may have been picked while this one was uploading.
      if (upload.current !== started) return;
      setPhotoKey(key);
      setTagging('waiting');
    } catch (cause) {
      // Nothing to recognize: saving tries the upload again and reports a failure then.
      if (upload.current === started) setTagging('idle');
      if (__DEV__) console.warn('Uploading the photo failed', cause);
    }
  }

  // Polls the photo until the vision model has tagged it, then fills in what the user hasn't.
  // A field the user already typed or picked is never overwritten.
  useEffect(() => {
    if (!photoKey) return;
    let cancelled = false;

    const poll = async () => {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const state = await getPhotoState(photoKey);
          if (cancelled) return;
          const { tags } = state;
          if (state.tagStatus === 'done' && tags?.recognized) {
            setName((current) => (current.trim() ? current : tags.name));
            setCategory((current) => current ?? tags.category);
            setItemColors((current) =>
              current.length > 0 ? current : tags.colors.slice(0, MAX_COLORS),
            );
            setSeasons(tags.seasons);
            // The brand only when the model read one (a label, a logo); the user's own stays.
            if (tags.brand && !edited.current.brand) {
              setBrand(tags.brand);
              setBrandOpen(true);
            }
            setTagging('filled');
            return;
          }
          // Processing failed, tagging is off, or the model gave up: the form stays as typed.
          if (state.status === 'failed' || state.tagStatus !== 'pending') break;
        } catch {
          // A dropped request is no reason to stop; the next poll tries again.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (!cancelled) setTagging('idle');
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [photoKey]);

  // "Another photo": the camera or the gallery, as the two buttons before the first photo.
  function another() {
    Alert.alert(t('addItem.anotherPhoto'), undefined, [
      { text: t('addItem.takePhoto'), onPress: () => void pick('camera') },
      { text: t('addItem.choosePhoto'), onPress: () => void pick('library') },
      { text: t('closet.cancel'), style: 'cancel' },
    ]);
  }

  function fail(key: ErrorKey) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setError(key);
  }

  // andStyle: "save and style it" goes on to the outfits for the new item; it uses the same
  // daily limit as the button on the item's screen, so it costs nothing extra.
  async function save(andStyle = false) {
    if (!photoUri) return fail('addItem.errors.photo');
    if (!name.trim()) return fail('addItem.errors.name');
    const paid = parsePrice(price);
    if (paid === undefined) return fail('addItem.errors.price');
    if (!category) return fail('addItem.errors.category');
    if (itemColors.length === 0) return fail('addItem.errors.colors');

    setError(null);
    setBusy(true);
    let created: Item;
    try {
      // Usually already uploaded while the form was filled in; if that upload failed, try once more.
      const uploaded = await (upload.current ?? Promise.reject(new Error('not uploaded'))).catch(
        () => uploadPhoto(photoUri, lang),
      );
      created = await createItem({
        name: name.trim(),
        category,
        colors: itemColors,
        seasons,
        photoKey: uploaded,
        brand: brand.trim() || null,
        price: paid,
        currency: paid === null ? null : currency,
      });
    } catch (cause) {
      setBusy(false);
      const code = limitReached(cause);
      if (code) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setLimit(code);
        return;
      }
      // The user sees a generic message; the real error goes to the Metro terminal.
      if (__DEV__) console.warn('Saving the item failed', cause);
      fail('addItem.errors.save');
      return;
    }

    // Saved: from here nothing shows a save error or allows saving again (it would make a second
    // piece); whatever goes wrong, the sheet just closes. `busy` stays on.
    setSaved(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (andStyle) {
      try {
        const { id } = await askWearWith({ itemId: created.id }, lang);
        leave(() =>
          router.replace({ pathname: '/styled/[id]', params: styledParams(id, created, null) }),
        );
        return;
      } catch (cause) {
        // The item is saved either way; only the outfits didn't start.
        const code = limitReached(cause);
        Alert.alert(code ? limitText(t, i18n.language, code) : t('wearWith.failed'));
      }
    }
    try {
      await hangUp(created, category);
    } catch (cause) {
      if (__DEV__) console.warn('Hanging the piece up failed', cause);
      leave(() => router.back());
    }
  }

  // "Hang it up": the piece flies to its rail, then the sheet closes (HangUp's onDone). The bare
  // cut-out flies if it comes within a few seconds, the photo otherwise.
  async function hangUp(created: Item, rail: ItemCategory) {
    const signal = closing.current?.signal;
    if (!signal || signal.aborted) return;
    const cutout = await waitForCutout(created, signal);
    if (signal.aborted) return;
    if (cutout) {
      // The background dissolves on the print first, then the bare piece leaves it.
      setBandCutout(cutout);
      if (!reduceMotion) await pause(DISSOLVE_MS, signal);
      if (signal.aborted) return;
    }
    const from = await measureBox(picture.current);
    if (signal.aborted) return;
    setHanging({ from, category: rail, cutout });
  }

  const note =
    tagging !== 'idle' ? (
      // Keyed by the state, so "filled in" fades in after "recognising" instead of swapping.
      <Animated.Text
        key={tagging}
        style={styles.bandNote}
        entering={FadeIn.duration(durations.state)}
        exiting={FadeOut.duration(durations.press)}
        accessibilityLiveRegion="polite"
      >
        {t(tagging === 'waiting' ? 'addItem.tagging' : 'addItem.tagged')}
      </Animated.Text>
    ) : !photoUri ? (
      <Text style={styles.bandNote}>{t('addItem.upToTwenty')}</Text>
    ) : null;

  return (
    <View
      ref={root}
      style={styles.screen}
      onLayout={() => root.current?.measureInWindow((_x, y) => setKeyboardOffset(y))}
    >
      <KeyboardAvoidingView
        style={styles.screen}
        // The view shrinks above the keyboard on both platforms, so the bar under the scroll (the
        // Hang button and its errors) stays in sight. It measures itself from its parent, not the
        // window, so on iOS it's told where the sheet starts (the sheet's top and the header).
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardOffset : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          // iOS keeps the focused field in sight; the inset is only what the keyboard still covers.
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
        >
          <PhotoBand
            photoUri={photoUri}
            caption={name}
            busy={busy}
            leaving={hanging !== null}
            onRotate={rotate}
            onCrop={() => photoUri && setCropping(photoUri)}
            onAnother={another}
            pictureRef={picture}
            note={note}
            cutout={bandCutout}
          />

          {photoUri ? (
            <FieldThread
              // Reading the photo, or saved and waiting for the cut-out: the same one sign.
              waiting={tagging === 'waiting' || (saved && hanging === null)}
              // The settle fade is for tags landing, not for the piece leaving.
              filled={tagging === 'filled' && !saved}
              rail={
                <Animated.View entering={rise.delay(STAGGER_STEP * 4)}>
                  <RailStop category={category} label={t('addItem.hangingOn')}>
                    <View style={styles.chips}>
                      {ITEM_CATEGORIES.map((c) => (
                        <Chip
                          key={c}
                          label={t(`closet.filters.${c}`)}
                          selected={category === c}
                          onPress={() => {
                            edited.current.category = true;
                            setCategory(c);
                          }}
                        />
                      ))}
                    </View>
                  </RailStop>
                </Animated.View>
              }
            >
              <Animated.View entering={rise.delay(STAGGER_STEP)}>
                <Stop kind={name.trim() ? 'filled' : 'empty'} label={t('addItem.name')}>
                  {/* Edited in place: the name itself is the field, blue while it's open. */}
                  <TextInput
                    style={[styles.name, nameFocused && styles.nameOpen]}
                    value={name}
                    onChangeText={(value) => {
                      edited.current.name = true;
                      setName(value);
                    }}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => setNameFocused(false)}
                    placeholder={t('addItem.namePlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    maxLength={120}
                    accessibilityLabel={t('addItem.name')}
                  />
                </Stop>
              </Animated.View>
              <Animated.View entering={rise.delay(STAGGER_STEP * 2)}>
                <Stop
                  kind={itemColors.length > 0 ? 'filled' : 'empty'}
                  label={`${t('addItem.colors')} · ${t('addItem.colorsHint')}`}
                >
                  <ColorSwatches
                    value={itemColors}
                    onChange={(value) => {
                      edited.current.colors = true;
                      setItemColors(value);
                    }}
                  />
                </Stop>
              </Animated.View>
              <Animated.View entering={rise.delay(STAGGER_STEP * 3)}>
                <Stop
                  kind="optional"
                  label={`${t('addItem.brandAndPrice')} · ${t('addItem.optional')}`}
                >
                  {brandOpen ? (
                    <BrandPriceFields
                      brand={brand}
                      onBrandChange={(value) => {
                        edited.current.brand = true;
                        setBrand(value);
                      }}
                      price={price}
                      onPriceChange={setPrice}
                      currency={currency}
                      onCurrencyChange={setCurrency}
                    />
                  ) : (
                    <PressableScale
                      style={styles.addBrand}
                      onPress={() => setBrandOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel={t('addItem.addBrandPrice')}
                    >
                      <Text style={styles.unknown}>{t('addItem.addShort')}</Text>
                    </PressableScale>
                  )}
                </Stop>
              </Animated.View>
            </FieldThread>
          ) : (
            // A mirror selfie has several pieces: that has its own screen, in place of this one.
            <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={styles.lookRow}>
              <PressableScale
                style={styles.lookLink}
                onPress={() => leave(() => router.replace('/add-look'))}
                accessibilityRole="link"
              >
                <Icon name="look" color={colors.text} size={18} strokeWidth={1.4} />
                <Text style={styles.lookLinkText}>{t('addLook.entry')}</Text>
              </PressableScale>
            </Animated.View>
          )}
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {limit && (
            <Text style={styles.error} accessibilityRole="alert">
              {limitText(t, i18n.language, limit)}
            </Text>
          )}
          {/* Keyed by the message, so a new error fades in again instead of swapping in place. */}
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
          {photoUri ? (
            <>
              {/* The bead at the thread's end. */}
              <Button
                kind="bright"
                label={t('addItem.hang')}
                onPress={() => void save()}
                // Once saved, the bead on the thread is the only sign of waiting.
                busy={busy && !saved}
                disabled={busy}
              />
              <PressableScale
                style={[styles.styleLink, busy && styles.off]}
                onPress={() => void save(true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
              >
                <Text style={maison.link}>{t('addItem.hangAndStyle')}</Text>
              </PressableScale>
            </>
          ) : (
            <>
              <Button
                kind="bright"
                label={t('addItem.takePhoto')}
                onPress={() => void pick('camera')}
                disabled={busy}
              />
              <Button
                kind="outline"
                label={t('addItem.choosePhoto')}
                onPress={() => void pick('library')}
                disabled={busy}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
      <PhotoCropper uri={cropping} onCancel={() => setCropping(null)} onDone={cropped} />
      {hanging && photoUri && (
        <HangUp
          pieces={[
            {
              key: photoUri,
              photo: hanging.cutout ? (
                // The bare piece with its thread-tinted shadow, as on the closet's rails.
                <View style={[styles.fill, cutoutShadow('hanging')]} testID="hung-cutout">
                  <Image
                    source={{ uri: hanging.cutout.uri, headers: hanging.cutout.headers }}
                    style={styles.fill}
                    contentFit="contain"
                  />
                </View>
              ) : (
                <Image
                  source={{ uri: photoUri }}
                  style={styles.fill}
                  contentFit="contain"
                  testID="hung-photo"
                />
              ),
              from: hanging.from,
              category: hanging.category,
              tilted: true,
            },
          ]}
          caption={t('addItem.hungOn', { rail: t(`closet.filters.${hanging.category}`) })}
          onDone={() => leave(() => router.back())}
        />
      )}
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 24,
  },
  // Thread-coloured text on the blue: the secondary ink, 4.9:1 or better there.
  bandNote: {
    ...maison.note,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  name: {
    minHeight: 40,
    paddingVertical: 2,
    paddingHorizontal: 0,
    borderBottomWidth: 1.2,
    borderBottomColor: colors.text,
    fontFamily: fonts.displayLight,
    fontSize: 26,
    color: colors.text,
    textAlign: 'left',
  },
  // Open for editing: powder blue, as a value opened in My profile.
  nameOpen: {
    backgroundColor: colors.ground,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  addBrand: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  // Not known yet: dashed, as everything in the app that isn't hers or known yet.
  unknown: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderBottomColor: colors.textMuted,
  },
  lookRow: {
    marginTop: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  lookLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  lookLinkText: {
    ...maison.note,
    flexShrink: 1,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: colors.background,
  },
  styleLink: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  off: {
    opacity: 0.5,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
});
