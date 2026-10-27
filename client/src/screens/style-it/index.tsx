import type { Item, OutfitMood, StyledEntry } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditorialCover } from '@/components/cover';
import { HangerLoader } from '@/components/hanger-loader';
import { ItemPhoto } from '@/components/item-photo';
import { Button, maison, ScreenTitle, SectionLabel } from '@/components/maison';
import { MoodChips } from '@/components/mood-chips';
import { PressableScale } from '@/components/pressable-scale';
import { useTabBarClearance } from '@/components/tab-bar';
import { ApiError, askWearWith, listItems, listStyled, sessionHeaders } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { StyleThread, type Chosen as StyledPiece } from './style-thread';

// Wardrobe pieces offered in the row; the rest are a scroll of the closet away.
const ROW_LIMIT = 24;

// The piece being styled: from the closet row (so it can be asked about again) or styled before.
type Chosen = StyledPiece & { item?: Item };

// "Style it": the feature that puts outfits together around one piece, on a tab of its own.
// A piece from a photo (a shop screenshot) on the cover, one from the closet in a row with the
// mood to keep to, and the pieces styled before. The chosen piece's outfits grow on a thread right
// here (2026-10-26, "The Thread"): the piece on top, each outfit full width hanging off the thread.
export function StyleIt() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const { usage, refresh: refreshUsage } = useUsage();
  const [items, setItems] = useState<Item[] | null>(null);
  const [styled, setStyled] = useState<StyledEntry[]>([]);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [mood, setMood] = useState<OutfitMood | null>(null);
  // The piece whose outfits are being asked for.
  const [asking, setAsking] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  // Brings the thread into view when a piece is chosen; on the first choice the thread isn't laid
  // out yet, so it scrolls once it is.
  const scroll = useRef<ScrollViewInstance>(null);
  const threadY = useRef<number | null>(null);
  const scrollWhenLaidOut = useRef(false);
  function choose(next: Chosen) {
    setChosen(next);
    // The thread may be far below: say the looks are on their way (iOS has no live regions).
    AccessibilityInfo.announceForAccessibility(t('wearWith.composing'));
    if (threadY.current === null) scrollWhenLaidOut.current = true;
    else scroll.current?.scrollTo({ y: threadY.current - 16, animated: true });
  }

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
      // The new piece joins "styled before" at once.
      listStyled().then(setStyled, () => {});
      choose({
        requestId: id,
        name: item.name,
        photoUrl: item.photoUrl ?? undefined,
        cutoutUrl: item.cutoutUrl ?? undefined,
        item,
      });
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
      ref={scroll}
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 20, paddingBottom: clearance },
      ]}
    >
      <Animated.View entering={rise} style={maison.gutter}>
        <ScreenTitle title={t('styleIt.title')} subtitle={t('styleIt.subtitle')} />
      </Animated.View>

      {/* The cover: a piece the user doesn't own yet, from a photo. */}
      <Animated.View entering={rise.delay(STAGGER_STEP)}>
        <EditorialCover
          eyebrow={t('styleIt.photoEyebrow')}
          title={t('styleIt.photoTitle')}
          text={t('styleIt.photoText')}
        >
          <Button
            label={t('styleIt.photoButton')}
            onPress={() => router.push('/wear-with-pick')}
            style={styles.blockButton}
          />
        </EditorialCover>
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

      {chosen && (
        <View
          onLayout={(event) => {
            threadY.current = event.nativeEvent.layout.y;
            if (!scrollWhenLaidOut.current) return;
            scrollWhenLaidOut.current = false;
            scroll.current?.scrollTo({ y: threadY.current - 16, animated: true });
          }}
        >
          <StyleThread
            chosen={chosen}
            headers={headers}
            onAskAgain={chosen.item ? () => style(chosen.item!) : undefined}
            asking={asking !== null}
          />
        </View>
      )}

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
              onPress={() =>
                choose({
                  requestId: entry.id,
                  name: entry.name,
                  photoUrl: entry.photoUrl ?? undefined,
                  cutoutUrl: entry.cutoutUrl ?? undefined,
                })
              }
              // While a piece is being asked about, its answer would replace this choice.
              disabled={asking !== null}
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
    gap: 28,
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
