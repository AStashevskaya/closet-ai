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

import { HangerLoader } from '@/components/hanger-loader';
import { Button, maison, ScreenTitle } from '@/components/maison';
import { useTabBarClearance } from '@/components/tab-bar';
import { askWearWith, listItems, listStyled, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { askFailedText, useUsage } from '@/lib/limits';
import { rise, STAGGER_STEP } from '@/motion';
import { colors } from '@/theme';

import { ClosetPicker } from './closet-picker';
import { DiaryStop } from './diary-stop';
import { StyleThread, type Chosen as StyledPiece } from './style-thread';

// The piece being styled: from the closet (so it can be asked about again) or styled before.
type Chosen = StyledPiece & { item?: Item };

// "Style it": outfits put together around one piece, on a tab of its own. A diary on one thread
// (decided 2026-10-28, prototype ~/Desktop/closet/wrinkle-lab/design-styleit, direction C): two
// ways in on top (a piece from the closet, in a sheet with the mood to keep to; or one from a
// photo, dashed: not hers yet), then every piece styled, newest first. The open one grows its
// outfits full width on the thread; the others are stops with their looks folded small.
export function StyleIt() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const { usage, refresh: refreshUsage } = useUsage();
  const [items, setItems] = useState<Item[] | null>(null);
  // The closet couldn't be read and there's none from before: say so rather than "it's empty".
  const [itemsFailed, setItemsFailed] = useState(false);
  const [styled, setStyled] = useState<StyledEntry[]>([]);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [mood, setMood] = useState<OutfitMood | null>(null);
  const [picking, setPicking] = useState(false);
  // The piece whose outfits are being asked for.
  const [asking, setAsking] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  // The piece chosen comes up to the top of the screen, its outfits below it. It scrolls once the
  // opened piece is laid out: the one open before folds as this one opens, so any position read
  // earlier is stale (owner, 2026-10-30: it jumped somewhere above). The diary's own place on the
  // screen is added, since a row's layout is relative to the diary.
  const scroll = useRef<ScrollViewInstance>(null);
  const diaryY = useRef(0);
  const scrollWhenLaidOut = useRef(false);
  function choose(next: Chosen) {
    setChosen(next);
    // The thread may be far below: say the looks are on their way (iOS has no live regions).
    AccessibilityInfo.announceForAccessibility(t('wearWith.composing'));
    scrollWhenLaidOut.current = true;
  }

  const load = useCallback(async () => {
    setItemsFailed(false);
    try {
      const all = await listItems();
      setItems(all.filter((item) => item.photoStatus === 'ready'));
    } catch {
      // A closet read before stays; with none, the error shows instead of the buttons.
      setItemsFailed(true);
    }
    try {
      setStyled(await listStyled());
    } catch {
      // Nice to have: the section just stays as it was.
    }
  }, []);
  // Reloads when the tab comes into view: a piece added or styled elsewhere shows up.
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
      if (__DEV__) console.warn('Asking for outfits failed', cause);
      Alert.alert(askFailedText(t, i18n.language, cause, usage));
    } finally {
      setAsking(null);
    }
  }

  // A closet piece can be asked about afresh; one styled before has its request polled again.
  const asked = chosen?.item;
  const left = usage ? Math.max(0, usage.wear_with.limit - usage.wear_with.used) : null;
  // The piece just asked about is on top before the list catches up with it.
  const entries: StyledEntry[] =
    chosen && !styled.some((entry) => entry.id === chosen.requestId)
      ? [
          {
            id: chosen.requestId,
            createdAt: new Date().toISOString(),
            mood: null,
            name: chosen.name,
            photoUrl: chosen.photoUrl ?? null,
            cutoutUrl: chosen.cutoutUrl ?? null,
            // Its looks are still being written.
            previews: [],
          },
          ...styled,
        ]
      : styled;

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
        {left !== null && (
          <Text style={maison.note}>
            {t('wearWith.left', { left, limit: usage!.wear_with.limit })}
          </Text>
        )}
      </Animated.View>

      {/* Two ways in: a piece of hers, or one from a photo she doesn't own yet (dashed: not hers). */}
      <Animated.View entering={rise.delay(STAGGER_STEP)} style={[maison.gutter, styles.start]}>
        {items === null && itemsFailed ? (
          <View style={styles.empty}>
            <Text style={maison.body}>{t('closet.loadError')}</Text>
            <Button kind="outline" label={t('closet.retry')} onPress={() => void load()} />
          </View>
        ) : items === null ? (
          <View style={styles.loading}>
            <HangerLoader />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={maison.body}>{t('styleIt.emptyCloset')}</Text>
            <Button
              kind="outline"
              label={t('styleIt.addFirst')}
              onPress={() => router.push('/add-item')}
            />
          </View>
        ) : (
          <View style={styles.buttons}>
            <Button
              kind="bright"
              label={t('styleIt.fromCloset')}
              onPress={() => setPicking(true)}
              busy={asking !== null}
              style={styles.button}
            />
            <Button
              kind="outline"
              label={t('styleIt.fromPhoto')}
              onPress={() => router.push('/wear-with-pick')}
              style={[styles.button, styles.dashed]}
            />
          </View>
        )}
      </Animated.View>

      {/* The diary: everything she styled, newest on top, on one thread; the open one grows its
          outfits full width, the others show theirs folded small. */}
      <Animated.View
        entering={rise.delay(STAGGER_STEP * 2)}
        style={styles.diary}
        testID="diary"
        onLayout={(event) => {
          diaryY.current = event.nativeEvent.layout.y;
        }}
      >
        {entries.length === 0 ? (
          <Text style={[maison.note, maison.gutter]}>{t('styleIt.historyEmpty')}</Text>
        ) : (
          entries.map((entry, index) =>
            entry.id === chosen?.requestId ? (
              <View
                key={entry.id}
                testID="open-stop"
                onLayout={(event) => {
                  if (!scrollWhenLaidOut.current) return;
                  scrollWhenLaidOut.current = false;
                  const y = diaryY.current + event.nativeEvent.layout.y - 16;
                  scroll.current?.scrollTo({ y: Math.max(0, y), animated: true });
                }}
              >
                <StyleThread
                  chosen={chosen}
                  headers={headers}
                  onAskAgain={asked ? () => style(asked) : undefined}
                  asking={asking !== null}
                  joined={index > 0}
                  continues={index < entries.length - 1}
                />
              </View>
            ) : (
              <DiaryStop
                key={entry.id}
                entry={entry}
                headers={headers}
                joined={index > 0}
                last={index === entries.length - 1}
                onOpen={() => {
                  // While a piece is being asked about, its answer would replace this choice.
                  if (asking !== null) return;
                  choose({
                    requestId: entry.id,
                    name: entry.name,
                    photoUrl: entry.photoUrl ?? undefined,
                    cutoutUrl: entry.cutoutUrl ?? undefined,
                  });
                }}
              />
            ),
          )
        )}
      </Animated.View>

      <ClosetPicker
        visible={picking}
        items={items ?? []}
        headers={headers}
        mood={mood}
        onMood={setMood}
        onPick={(item) => {
          setPicking(false);
          void style(item);
        }}
        onClose={() => setPicking(false)}
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
    gap: 24,
  },
  start: {
    gap: 10,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingHorizontal: 12,
  },
  // From a photo: a piece that isn't hers yet, so dashed, as on Inspiration.
  dashed: {
    borderStyle: 'dashed',
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  empty: {
    gap: 12,
  },
  diary: {
    paddingStart: 6,
    paddingEnd: 20,
  },
});
