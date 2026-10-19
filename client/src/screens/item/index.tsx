import {
  ITEM_CATEGORIES,
  ITEM_COLORS,
  SEASONS,
  type ItemCategory,
  type ItemColor,
  type ItemDetail,
  type ItemTags,
  type Season,
  type SimilarItem,
} from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Chip } from '@/components/chip';
import { ItemPhoto } from '@/components/item-photo';
import { PressableScale } from '@/components/pressable-scale';
import { deleteItem, getItem, getSimilarItems, sessionHeaders, updateItem } from '@/lib/api';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

const MAX_COLORS = 5;

// The editable part of an item: what the user can correct when the model got it wrong.
type Draft = { name: string; category: ItemCategory; colors: ItemColor[]; seasons: Season[] };

const draftOf = (item: ItemDetail): Draft => ({
  name: item.name,
  category: item.category,
  colors: item.colors,
  seasons: item.seasons,
});

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; item: ItemDetail };

export function ItemScreen({ id }: { id: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<SimilarItem[]>([]);

  const load = useCallback(async () => {
    try {
      const item = await getItem(id);
      setState({ status: 'ready', item });
      setDraft(draftOf(item));
    } catch {
      setState({ status: 'error' });
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
    return <ActivityIndicator style={styles.center} color={colors.accent} />;
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
  const valid = draft.name.trim().length > 0 && draft.colors.length > 0;
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
      await updateItem(id, { ...draft, name: draft.name.trim() });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (cause) {
      if (__DEV__) console.warn('Saving the item failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('item.saveError'));
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
      <Stack.Screen options={{ title: item.name }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        <ItemPhoto item={item} headers={headers} style={styles.photo} />

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
                    onPress={() =>
                      router.push({ pathname: '/item/[id]', params: { id: other.id } })
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

        <PressableScale
          style={[styles.button, (!dirty || !valid || busy) && styles.buttonDisabled]}
          onPress={save}
          disabled={!dirty || !valid || busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>{t('item.save')}</Text>
          )}
        </PressableScale>

        <Pressable
          style={styles.deleteButton}
          onPress={confirmDelete}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={styles.deleteText}>{t('item.delete')}</Text>
        </Pressable>
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
    padding: 22,
    paddingBottom: 40,
    gap: 10,
  },
  photo: {
    alignSelf: 'center',
    width: '80%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
  },
  label: {
    marginTop: 12,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  input: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
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
    marginHorizontal: -22,
  },
  similarRow: {
    paddingHorizontal: 22,
    gap: 12,
  },
  similarCard: {
    width: 104,
    gap: 6,
  },
  similarPhoto: {
    width: 104,
    aspectRatio: 3 / 4,
    borderRadius: 14,
  },
  similarName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text,
    textAlign: 'left',
  },
  button: {
    height: 52,
    marginTop: 20,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
  deleteButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.error,
  },
});
