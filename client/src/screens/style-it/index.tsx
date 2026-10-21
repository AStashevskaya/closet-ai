import type { Item, OutfitMood, StyledEntry } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HangerLoader } from '@/components/hanger-loader';
import { ItemPhoto } from '@/components/item-photo';
import { Button, maison, ScreenTitle, SectionLabel } from '@/components/maison';
import { MoodChips } from '@/components/mood-chips';
import { PressableScale } from '@/components/pressable-scale';
import { TAB_BAR_CLEARANCE } from '@/components/tab-bar';
import { ApiError, askWearWith, listItems, listStyled, sessionHeaders } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// Wardrobe pieces offered in the row; the rest are a scroll of the closet away.
const ROW_LIMIT = 24;

// "Style it": the feature that puts outfits together around one piece, on a tab of its own.
// A piece from a photo (a shop screenshot) on the bright block, one from the closet in a row
// with the mood to keep to, and the pieces styled before, to open their outfits again.
export function StyleIt() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const { usage, refresh: refreshUsage } = useUsage();
  const [items, setItems] = useState<Item[] | null>(null);
  const [styled, setStyled] = useState<StyledEntry[]>([]);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [mood, setMood] = useState<OutfitMood | null>(null);
  // The piece whose outfits are being asked for.
  const [asking, setAsking] = useState<string | null>(null);

  // Reloads when the tab comes into view: a piece added or styled elsewhere shows up.
  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          const all = await listItems();
          setItems(all.filter((item) => item.photoStatus === 'ready'));
        } catch {
          setItems((current) => current ?? []);
        }
        try {
          setStyled(await listStyled());
        } catch {
          // Nice to have: the section just stays as it was.
        }
      };
      void load();
    }, []),
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

  async function style(item: Item) {
    setAsking(item.id);
    void Haptics.selectionAsync();
    try {
      const { id } = await askWearWith(
        mood ? { itemId: item.id, mood } : { itemId: item.id },
        lang,
      );
      void refreshUsage();
      router.push({ pathname: '/wear-with/[id]', params: { id } });
    } catch (cause) {
      const code = limitReached(cause);
      if (code) Alert.alert(limitText(t, i18n.language, code, usage));
      else if (cause instanceof ApiError && cause.status === 503) Alert.alert(t('wearWith.off'));
      else {
        if (__DEV__) console.warn('Asking for outfits failed', cause);
        Alert.alert(t('wearWith.failed'));
      }
    } finally {
      setAsking(null);
    }
  }

  const left = usage ? Math.max(0, usage.wear_with.limit - usage.wear_with.used) : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
    >
      <Animated.View entering={rise} style={maison.gutter}>
        <ScreenTitle title={t('styleIt.title')} subtitle={t('styleIt.subtitle')} />
      </Animated.View>

      {/* The bright block: a piece the user doesn't own yet, from a photo. */}
      <Animated.View entering={rise.delay(STAGGER_STEP)} style={styles.block}>
        <Text style={styles.eyebrow}>{t('styleIt.photoEyebrow')}</Text>
        <Text style={styles.blockTitle}>{t('styleIt.photoTitle')}</Text>
        <Text style={styles.blockText}>{t('styleIt.photoText')}</Text>
        <Button
          label={t('styleIt.photoButton')}
          onPress={() => router.push('/wear-with-pick')}
          style={styles.blockButton}
        />
      </Animated.View>

      <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={styles.section}>
        <View style={maison.gutter}>
          <SectionLabel>{t('styleIt.closet')}</SectionLabel>
          <Text style={maison.note}>
            {t('styleIt.closetHint')}
            {left !== null && ` · ${t('wearWith.left', { left, limit: usage!.wear_with.limit })}`}
          </Text>
        </View>
        <MoodChips mood={mood} onChange={setMood} inset={20} />

        {items === null ? (
          <View style={styles.loading}>
            <HangerLoader />
          </View>
        ) : items.length === 0 ? (
          <View style={[maison.gutter, styles.empty]}>
            <Text style={maison.body}>{t('styleIt.emptyCloset')}</Text>
            <Button
              kind="outline"
              label={t('styleIt.addFirst')}
              onPress={() => router.push('/add-item')}
            />
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {items.slice(0, ROW_LIMIT).map((item) => (
              <PressableScale
                key={item.id}
                style={styles.piece}
                onPress={() => style(item)}
                disabled={asking !== null}
                accessibilityRole="button"
                accessibilityLabel={t('wearWith.button') + ' ' + item.name}
                accessibilityState={{ busy: asking === item.id }}
              >
                <ItemPhoto item={item} headers={headers} style={styles.pieceImage} />
                {asking === item.id && (
                  <View style={styles.pieceBusy}>
                    <HangerLoader size="small" />
                  </View>
                )}
                <Text style={styles.pieceName} numberOfLines={2}>
                  {item.name}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        )}
      </Animated.View>

      <Animated.View
        entering={rise.delay(STAGGER_STEP * 3)}
        style={[maison.gutter, styles.section]}
      >
        <SectionLabel>{t('styleIt.history')}</SectionLabel>
        {styled.length === 0 ? (
          <Text style={maison.note}>{t('styleIt.historyEmpty')}</Text>
        ) : (
          styled.map((entry) => (
            <PressableScale
              key={entry.id}
              style={styles.entry}
              onPress={() => router.push({ pathname: '/wear-with/[id]', params: { id: entry.id } })}
              accessibilityRole="button"
              accessibilityLabel={t('styleIt.open', { name: entry.name })}
            >
              <ItemPhoto
                item={{
                  photoUrl: entry.photoUrl ?? undefined,
                  cutoutUrl: entry.cutoutUrl ?? undefined,
                }}
                headers={headers}
                style={styles.entryImage}
              />
              <View style={styles.entryText}>
                <Text style={styles.entryName} numberOfLines={2}>
                  {entry.name}
                </Text>
                <Text style={maison.note}>
                  {new Date(entry.createdAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                  })}
                  {entry.mood && ` · ${t(`wearWith.moods.${entry.mood}`)}`}
                </Text>
              </View>
            </PressableScale>
          ))
        )}
      </Animated.View>
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
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: 28,
  },
  block: {
    marginHorizontal: 10,
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    gap: 8,
    backgroundColor: colors.highlight,
  },
  eyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
  blockTitle: {
    fontFamily: fonts.displayLight,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  blockText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
    textAlign: 'left',
  },
  blockButton: {
    marginTop: 12,
  },
  section: {
    gap: 12,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  empty: {
    gap: 14,
  },
  row: {
    paddingHorizontal: 20,
    gap: 10,
  },
  piece: {
    width: 128,
    gap: 8,
  },
  pieceImage: {
    width: 128,
    aspectRatio: 3 / 4,
  },
  pieceBusy: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: 128,
    aspectRatio: 3 / 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  pieceName: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.text,
    textAlign: 'left',
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  entryImage: {
    width: 60,
    aspectRatio: 3 / 4,
  },
  entryText: {
    flex: 1,
    gap: 4,
  },
  entryName: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
});
