import {
  ITEM_CATEGORIES,
  ITEM_COLORS,
  SEASONS,
  type Currency,
  type ItemCategory,
  type ItemColor,
  type ItemDetail,
  type ItemTags,
  type Season,
  type SimilarItem,
  type OutfitMood,
} from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeIn, Keyframe } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HangerLoader } from '@/components/hanger-loader';
import { Chip } from '@/components/chip';
import { BrandPriceFields } from '@/components/brand-price-fields';
import { Button, maison } from '@/components/maison';
import { MoodChips } from '@/components/mood-chips';
import { ItemPhoto } from '@/components/item-photo';
import { PressableScale } from '@/components/pressable-scale';
import { RotateButton } from '@/components/rotate-button';
import {
  absoluteUrl,
  askWearWith,
  deleteItem,
  getItem,
  getSimilarItems,
  rotateItem,
  sessionHeaders,
  updateItem,
} from '@/lib/api';
import { ApiError, limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { defaultCurrency, parsePrice, priceText } from '@/lib/price';
import { durations, EASE_OUT, rise, STAGGER_STEP } from '@/motion';
import { styledParams } from '@/screens/styled';
import { colors, fonts } from '@/theme';

const MAX_COLORS = 5;

// The editable part of an item: what the user can correct when the model got it wrong.
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

const draftOf = (item: ItemDetail): Draft => ({
  name: item.name,
  category: item.category,
  colors: item.colors,
  seasons: item.seasons,
  brand: item.brand ?? '',
  price: priceText(item.price),
  currency: item.currency ?? defaultCurrency(),
});

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

// The picture settles in from a little zoom, slowly.
const settle = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 1.08 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(durations.settle);

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; item: ItemDetail };

export function ItemScreen({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { usage, refresh: refreshUsage } = useUsage();
  // The mood asked of the outfits; null for any.
  const [mood, setMood] = useState<OutfitMood | null>(null);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  // The item as last loaded, to tell unsaved corrections from what the server has.
  const loaded = useRef<ItemDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const item = await getItem(id);
      const previous = loaded.current;
      loaded.current = item;
      setState({ status: 'ready', item });
      // Coming back from the outfits reloads the item: corrections not saved yet stay.
      setDraft((current) =>
        current && previous && !sameDraft(current, draftOf(previous)) ? current : draftOf(item),
      );
    } catch {
      // A failed reload keeps the item already shown; only a first load shows the error.
      setState((current) => (current.status === 'ready' ? current : { status: 'error' }));
      return;
    }
    // A nice-to-have: if it fails, the row just stays hidden.
    try {
      setSimilar(await getSimilarItems(id));
    } catch {
      setSimilar([]);
    }
  }, [id]);

  // Loads when the screen comes into view, like the closet does.
  // The callback may only return a cleanup function, not a promise, hence the wrapper.
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

  if (state.status === 'loading' || (state.status === 'ready' && !draft)) {
    return (
      <View style={styles.center}>
        <HangerLoader />
      </View>
    );
  }

  if (state.status === 'error' || !draft) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('item.loadError')}</Text>
        <Pressable
          onPress={() => {
            setState({ status: 'loading' });
            void load();
          }}
          accessibilityRole="button"
        >
          <Text style={styles.link}>{t('closet.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const { item } = state;
  const dirty = !sameDraft(draft, draftOf(item));
  const valid =
    draft.name.trim().length > 0 &&
    draft.colors.length > 0 &&
    parsePrice(draft.price) !== undefined;
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  const toggle = <T,>(list: T[], value: T, max = Infinity) =>
    list.includes(value)
      ? list.filter((v) => v !== value)
      : list.length < max
        ? [...list, value]
        : list;

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const { brand, price, currency, ...fields } = draft;
      const paid = parsePrice(price) ?? null;
      await updateItem(id, {
        ...fields,
        name: draft.name.trim(),
        brand: brand.trim() || null,
        price: paid,
        currency: paid === null ? null : currency,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (cause) {
      if (__DEV__) console.warn('Saving the item failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('item.saveError'));
      setBusy(false);
    }
  }

  async function wearWith() {
    if (state.status !== 'ready') return;
    const { item } = state;
    setBusy(true);
    try {
      const { id: requestId } = await askWearWith(
        mood ? { itemId: id, mood } : { itemId: id },
        appLanguage(i18n.language),
      );
      void refreshUsage();
      // Its outfits grow on Style it's thread, over this screen: back returns to the piece.
      router.push({ pathname: '/styled/[id]', params: styledParams(requestId, item, mood) });
    } catch (cause) {
      const code = limitReached(cause);
      if (code) Alert.alert(limitText(t, i18n.language, code, usage));
      else if (cause instanceof ApiError && cause.status === 503) Alert.alert(t('wearWith.off'));
      else {
        if (__DEV__) console.warn('Asking for outfits failed', cause);
        Alert.alert(t('wearWith.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  // Saved on the server at once, apart from the fields: unsaved corrections stay in the draft.
  async function rotate() {
    setBusy(true);
    try {
      const turned = await rotateItem(id);
      setState({ status: 'ready', item: turned });
      void Haptics.selectionAsync();
    } catch (cause) {
      if (__DEV__) console.warn('Turning the photo failed', cause);
      Alert.alert(t('item.rotateError'));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert(t('closet.deleteTitle', { name: item.name }), t('closet.deleteMessage'), [
      { text: t('closet.cancel'), style: 'cancel' },
      {
        text: t('closet.delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteItem(id);
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.back();
          } catch {
            Alert.alert(t('closet.deleteError'));
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS is handled by the ScrollView below; Android still needs the view to shrink.
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {/* Full bleed under the see-through header: the cut-out on a soft wash of its own
            photo, blurred, as on Dior's product pages; a photo without one fills the frame. */}
        <View style={[styles.hero, { height: Math.round(height * 0.6) }]}>
          {item.cutoutUrl && item.photoUrl && headers && (
            <>
              <Image
                source={{ uri: absoluteUrl(item.photoUrl), headers }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={60}
                accessibilityIgnoresInvertColors
              />
              <View style={styles.wash} />
            </>
          )}
          <Animated.View
            entering={settle}
            style={[
              styles.heroPicture,
              item.cutoutUrl && { paddingTop: insets.top + 56, paddingBottom: 28 },
            ]}
          >
            <ItemPhoto item={item} headers={headers} style={styles.heroImage} />
          </Animated.View>
          {item.photoUrl && <RotateButton onPress={rotate} disabled={busy} style={styles.rotate} />}
        </View>

        <View style={styles.body}>
          <Animated.View entering={rise} style={styles.heading}>
            <Text style={styles.name} accessibilityRole="header">
              {item.name}
            </Text>
            <Text style={maison.note}>
              {[t(`categories.${item.category}`), ...item.colors.map((c) => t(`colors.${c}`))].join(
                ' · ',
              )}
            </Text>
          </Animated.View>

          {item.photoUrl && (
            <Animated.View entering={rise.delay(STAGGER_STEP)} style={styles.wearWith}>
              <View style={styles.edgeToEdge}>
                <MoodChips mood={mood} onChange={setMood} inset={20} />
              </View>
              <Button kind="bright" label={t('wearWith.button')} onPress={wearWith} busy={busy} />
              {usage && (
                <Text style={[maison.note, styles.centered]}>
                  {t('wearWith.left', {
                    left: Math.max(0, usage.wear_with.limit - usage.wear_with.used),
                    limit: usage.wear_with.limit,
                  })}
                </Text>
              )}
            </Animated.View>
          )}

          <Text style={styles.label}>{t('addItem.name')}</Text>
          <TextInput
            style={styles.input}
            value={draft.name}
            onChangeText={(name) => update({ name })}
            maxLength={120}
            accessibilityLabel={t('addItem.name')}
          />

          <Text style={styles.label}>{t('addItem.category')}</Text>
          <View style={styles.chips}>
            {ITEM_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={t(`categories.${c}`)}
                selected={draft.category === c}
                onPress={() => update({ category: c })}
              />
            ))}
          </View>

          <Text style={styles.label}>
            {t('addItem.colors')} <Text style={styles.hint}>· {t('addItem.colorsHint')}</Text>
          </Text>
          <View style={styles.chips}>
            {ITEM_COLORS.map((c) => (
              <Chip
                key={c}
                label={t(`colors.${c}`)}
                color={c}
                selected={draft.colors.includes(c)}
                onPress={() => update({ colors: toggle(draft.colors, c, MAX_COLORS) })}
              />
            ))}
          </View>

          <Text style={styles.label}>{t('item.seasons')}</Text>
          <View style={styles.chips}>
            {SEASONS.map((s) => (
              <Chip
                key={s}
                label={t(`seasons.${s}`)}
                selected={draft.seasons.includes(s)}
                onPress={() => update({ seasons: toggle(draft.seasons, s) })}
              />
            ))}
          </View>

          <BrandPriceFields
            brand={draft.brand}
            onBrandChange={(brand) => update({ brand })}
            price={draft.price}
            onPriceChange={(price) => update({ price })}
            currency={draft.currency}
            onCurrencyChange={(currency) => update({ currency })}
          />

          <Text style={styles.label}>{t('item.fromPhoto')}</Text>
          <PhotoDetails tags={item.tags} />

          {similar.length > 0 && headers && (
            <>
              <Text style={styles.label}>{t('item.similar')}</Text>
              <Animated.View entering={FadeIn.duration(durations.enter)}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.similarRow}
                  style={styles.similarScroll}
                >
                  {similar.map((other) => (
                    <PressableScale
                      key={other.id}
                      style={styles.similarCard}
                      // In place of this one, so back leads where the item was opened from (the
                      // closet), not through every item looked at on the way.
                      onPress={() =>
                        router.replace({ pathname: '/item/[id]', params: { id: other.id } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={other.name}
                    >
                      <ItemPhoto item={other} headers={headers} style={styles.similarPhoto} />
                      <Text style={styles.similarName} numberOfLines={2}>
                        {other.name}
                      </Text>
                    </PressableScale>
                  ))}
                </ScrollView>
              </Animated.View>
            </>
          )}

          <Button
            label={t('item.save')}
            onPress={save}
            disabled={!dirty || !valid}
            busy={busy}
            style={styles.save}
          />

          <Pressable
            style={styles.deleteButton}
            onPress={confirmDelete}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.deleteText}>{t('item.delete')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// What the vision model noticed beyond the form's fields, read-only for now. Fit and condition
// are translated; length, fabric and style are stored in English for search and shown as stored.
function PhotoDetails({ tags }: { tags: ItemTags | null }) {
  const { t } = useTranslation();

  if (!tags || !tags.recognized) {
    return <Text style={styles.muted}>{t(tags ? 'item.notRecognized' : 'item.notTagged')}</Text>;
  }

  const rows = [
    { label: t('item.fit'), value: tags.fit && t(`item.fits.${tags.fit}`) },
    { label: t('item.length'), value: tags.length },
    { label: t('item.fabric'), value: tags.fabric },
    { label: t('item.style'), value: tags.style },
    { label: t('item.brand'), value: tags.brand },
    { label: t('item.condition'), value: tags.condition && t(`item.conditions.${tags.condition}`) },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));

  return (
    <Animated.View style={styles.details} entering={FadeIn.duration(durations.enter)}>
      {rows.map((row, index) => (
        <View key={row.label} style={[styles.detailRow, index > 0 && styles.detailDivider]}>
          <Text style={styles.detailLabel}>{row.label}</Text>
          <Text style={styles.detailValue}>{row.value}</Text>
        </View>
      ))}
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  link: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.accent,
  },
  content: {
    paddingBottom: 48,
  },
  hero: {
    overflow: 'hidden',
    backgroundColor: colors.hero,
  },
  // Keeps the blurred photo to a soft wash of its colours.
  wash: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(243, 242, 239, 0.55)',
  },
  heroPicture: {
    flex: 1,
    paddingHorizontal: 36,
  },
  heroImage: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  rotate: {
    position: 'absolute',
    bottom: 14,
    end: 14,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 22,
    gap: 10,
  },
  heading: {
    gap: 6,
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  wearWith: {
    marginTop: 14,
    gap: 12,
  },
  edgeToEdge: {
    marginHorizontal: -20,
  },
  centered: {
    textAlign: 'center',
  },
  label: {
    marginTop: 22,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  // An underlined field, as on a brand's checkout, instead of a boxed one.
  input: {
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  muted: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: 'left',
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  detailRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  detailDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  detailLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  detailValue: {
    flexShrink: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
    textAlign: 'right',
  },
  // The row runs edge to edge under the screen's padding.
  similarScroll: {
    marginHorizontal: -20,
  },
  similarRow: {
    paddingHorizontal: 20,
    gap: 12,
  },
  similarCard: {
    width: 104,
    gap: 6,
  },
  similarPhoto: {
    width: 104,
    aspectRatio: 3 / 4,
  },
  similarName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text,
    textAlign: 'left',
  },
  save: {
    marginTop: 28,
  },
  deleteButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
  },
});
