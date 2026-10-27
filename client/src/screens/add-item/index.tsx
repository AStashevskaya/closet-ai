import type { Currency, ItemCategory, ItemColor, LimitCode, Season } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { BrandPriceFields } from '@/components/brand-price-fields';
import { ItemFields, MAX_COLORS } from '@/components/item-fields';
import { PhotoCropper } from '@/components/photo-cropper';
import { CropButton, RotateButton } from '@/components/rotate-button';
import { HangerLoader } from '@/components/hanger-loader';
import { PressableScale } from '@/components/pressable-scale';
import { askWearWith, createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText } from '@/lib/limits';
import { defaultCurrency, parsePrice } from '@/lib/price';
import { rotatePhoto, shrinkPhoto } from '@/lib/shrink-photo';
import { styledParams } from '@/lib/styled';
import { useConfirmLeave } from '@/lib/use-confirm-leave';
import { durations } from '@/motion';
import type { PickedPhoto } from '@/screens/add-items';
import { colors, fonts } from '@/theme';

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
  // A picked photo or a typed name is worth asking about before the sheet closes.
  const leave = useConfirmLeave(photoUri !== null || name.trim() !== '');

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
            if (tags.brand && !edited.current.brand) setBrand(tags.brand);
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
    try {
      // Usually already uploaded while the form was filled in; if that upload failed, try once more.
      const uploaded = await (upload.current ?? Promise.reject(new Error('not uploaded'))).catch(
        () => uploadPhoto(photoUri, lang),
      );
      const created = await createItem({
        name: name.trim(),
        category,
        colors: itemColors,
        seasons,
        photoKey: uploaded,
        brand: brand.trim() || null,
        price: paid,
        currency: paid === null ? null : currency,
      });
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
      leave(() => router.back());
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
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS is handled by the ScrollView below; Android still needs the view to shrink.
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // iOS insets the scroll view by the keyboard and keeps the focused field above it.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {photoUri ? (
          <View style={styles.photo}>
            <Image
              source={{ uri: photoUri }}
              style={styles.photoImage}
              contentFit="cover"
              transition={250}
            />
            <View style={styles.photoActions}>
              <CropButton onPress={() => setCropping(photoUri)} disabled={busy} />
              <RotateButton onPress={rotate} disabled={busy} />
            </View>
          </View>
        ) : (
          <View style={[styles.photo, styles.photoEmpty]} />
        )}

        <View style={styles.photoButtons}>
          <PressableScale
            style={styles.secondaryButton}
            onPress={() => pick('camera')}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>
              {t(photoUri ? 'addItem.changePhoto' : 'addItem.takePhoto')}
            </Text>
          </PressableScale>
          <PressableScale
            style={styles.secondaryButton}
            onPress={() => pick('library')}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>{t('addItem.choosePhoto')}</Text>
          </PressableScale>
        </View>

        {/* A mirror selfie has several items: that has its own screen, in place of this one. */}
        {!photoUri && (
          <PressableScale
            style={styles.lookLink}
            onPress={() => leave(() => router.replace('/add-look'))}
            accessibilityRole="link"
          >
            <Icon name="look" color={colors.accent} size={18} strokeWidth={1.5} />
            <Text style={styles.lookLinkText}>{t('addLook.entry')}</Text>
          </PressableScale>
        )}

        {/* Keyed by the state, so "filled in" fades in after "recognising" instead of swapping. */}
        {tagging !== 'idle' && (
          <Animated.View
            key={tagging}
            style={styles.tagging}
            entering={FadeIn.duration(durations.state)}
            exiting={FadeOut.duration(durations.press)}
            accessibilityLiveRegion="polite"
          >
            {tagging === 'waiting' && <HangerLoader size="small" />}
            <Text style={styles.taggingText}>
              {t(tagging === 'waiting' ? 'addItem.tagging' : 'addItem.tagged')}
            </Text>
          </Animated.View>
        )}

        <ItemFields
          name={name}
          onNameChange={(value) => {
            edited.current.name = true;
            setName(value);
          }}
          category={category}
          onCategoryChange={(value) => {
            edited.current.category = true;
            setCategory(value);
          }}
          itemColors={itemColors}
          onColorsChange={(value) => {
            edited.current.colors = true;
            setItemColors(value);
          }}
        />
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

        <PressableScale
          style={[styles.button, busy && styles.buttonBusy]}
          onPress={() => save()}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>{t('addItem.save')}</Text>
          )}
        </PressableScale>
        <PressableScale
          style={[styles.styleButton, busy && styles.buttonBusy]}
          onPress={() => save(true)}
          disabled={busy}
          accessibilityRole="button"
        >
          <Icon name="spark" color={colors.accent} size={16} strokeWidth={1.6} />
          <Text style={styles.styleButtonText}>{t('addItem.saveAndStyle')}</Text>
        </PressableScale>
      </ScrollView>
      <PhotoCropper uri={cropping} onCancel={() => setCropping(null)} onDone={cropped} />
    </KeyboardAvoidingView>
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
  photo: {
    alignSelf: 'center',
    width: '70%',
    aspectRatio: 3 / 4,
  },
  photoImage: {
    flex: 1,
  },
  photoEmpty: {
    backgroundColor: colors.hero,
  },
  photoActions: {
    position: 'absolute',
    bottom: 10,
    end: 10,
    flexDirection: 'row',
    gap: 8,
  },
  photoButtons: {
    marginTop: 6,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.accent,
    textAlign: 'center',
  },
  lookLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.accentSoft,
  },
  lookLinkText: {
    flexShrink: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.accent,
    textAlign: 'center',
  },
  tagging: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 24,
  },
  taggingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
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
    marginTop: 16,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  styleButton: {
    flexDirection: 'row',
    gap: 8,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.accent,
  },
  buttonBusy: {
    opacity: 0.8,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
});
