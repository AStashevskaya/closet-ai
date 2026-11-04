import type { Item, OutfitMood, StyledEntry } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, maison, ScreenTitle } from '@/components/maison';
import { useTabBarClearance } from '@/components/tab-bar';
import { useAnnounce } from '@/lib/announce';
import { askWearWith, listItems, listStyled, sessionHeaders } from '@/lib/api';
import { isOffline } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { askFailedText, useUsage } from '@/lib/limits';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { colors } from '@/theme';

import { ClosetPicker } from './closet-picker';
import { DiaryStop } from './diary-stop';
import { StyleThread, type Chosen as StyledPiece } from './style-thread';
import { ThreadWaiting } from './thread-row';

// The piece being styled: from the closet (so it can be asked about again) or styled before.
type Chosen = StyledPiece & { item?: Item };

// A read that didn't go through, and whether it's the connection.
type Failure = { offline: boolean };

// The first screenful of stops settles in one after another.
const SETTLING = 8;

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
  const [styled, setStyled] = useState<StyledEntry[] | null>(null);
  // A read that failed, apart from an empty answer: "nothing here yet" only comes once a load has
  // ended. It only counts with nothing from before to show.
  const [itemsFailure, setItemsFailure] = useState<Failure | null>(null);
  const [styledFailure, setStyledFailure] = useState<Failure | null>(null);
  // Deleted here: a list read just before must not bring them back.
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set());
  // When the list was read: the diary's wishes count their week down from it.
  const [readAt, setReadAt] = useState(0);
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
    scrollWhenLaidOut.current = true;
  }

  // Read together and landing together: one bead, then everything settles in at one go. What was
  // read before stays when a reload fails.
  const load = useCallback(async () => {
    const [closet, diary] = await Promise.allSettled([listItems(), listStyled()]);
    if (closet.status === 'fulfilled') {
      setItems(closet.value.filter((item) => item.photoStatus === 'ready'));
      setItemsFailure(null);
    } else {
      setItemsFailure({ offline: isOffline(closet.reason) });
    }
    if (diary.status === 'fulfilled') {
      setStyled(diary.value);
      setReadAt(Date.now());
      setStyledFailure(null);
    } else {
      setStyledFailure({ offline: isOffline(diary.reason) });
    }
  }, []);
  // Reloads when the tab comes into view: a piece added or styled elsewhere shows up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // Back to waiting in place. With the closet to read again the diary waits with it, so the bead has
  // its thread free.
  function retry() {
    setItemsFailure(null);
    setStyledFailure(null);
    if (items === null) setStyled(null);
    void load();
  }

  // Once the stops have settled in, a stop mounted later (one folding) doesn't play it again.
  const [settled, setSettled] = useState(false);
  const diaryRead = styled !== null;
  useEffect(() => {
    if (!diaryRead) return;
    const timer = setTimeout(() => setSettled(true), SETTLING * STAGGER_STEP + durations.arrive);
    return () => clearTimeout(timer);
  }, [diaryRead]);

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

  function onDeleted(id: string) {
    setDeleted((before) => new Set(before).add(id));
    // Its stop goes, and with it the polling for its looks.
    setChosen((open) => (open?.requestId === id ? null : open));
  }

  // A closet piece can be asked about afresh; one styled before has its request polled again.
  const asked = chosen?.item;
  const left = usage ? Math.max(0, usage.wear_with.limit - usage.wear_with.used) : null;
  // The piece just asked about is on top before the list catches up with it.
  const listed = (styled ?? []).filter((entry) => !deleted.has(entry.id));
  const entries: StyledEntry[] =
    chosen && !listed.some((entry) => entry.id === chosen.requestId)
      ? [
          {
            id: chosen.requestId,
            createdAt: new Date().toISOString(),
            mood: null,
            name: chosen.name,
            photoUrl: chosen.photoUrl ?? null,
            cutoutUrl: chosen.cutoutUrl ?? null,
            loose: false,
            wishAskAt: null,
            // Its looks are still being written.
            previews: [],
          },
          ...listed,
        ]
      : listed;

  // Only with nothing from before to show.
  const closetFailed = items === null ? itemsFailure : null;
  const diaryFailed = styled === null ? styledFailure : null;
  const waiting =
    (items === null && itemsFailure === null) || (styled === null && styledFailure === null);
  const closetError =
    closetFailed && t(closetFailed.offline ? 'common.offline' : 'closet.loadError');
  const diaryError = diaryFailed && t(diaryFailed.offline ? 'common.offline' : 'styleIt.loadError');
  // Both failing say one thing, with one retry: it reads both again. The diary's error shows only
  // with no stops at all (the piece just asked about may be one).
  useAnnounce(
    waiting ? t('common.loading') : (closetError ?? (entries.length === 0 ? diaryError : null)),
  );

  return (
    <ScrollView
      ref={scroll}
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 20, paddingBottom: clearance },
      ]}
    >
      {/* One layout for every state (docs/design.md, "Waiting"): the title and the diary's thread
          stay where they are, and what's read settles in around them; nothing here enters again. */}
      <View style={maison.gutter}>
        <ScreenTitle title={t('styleIt.title')} subtitle={t('styleIt.subtitle')} />
        {/* Its line is kept, so what's below doesn't move when it comes. */}
        <View style={styles.leftLine}>
          {left !== null && (
            <Animated.Text style={maison.note} entering={arrive}>
              {t('wearWith.left', { left, limit: usage!.wear_with.limit })}
            </Animated.Text>
          )}
        </View>
      </View>

      {/* Two ways in: a piece of hers, or one from a photo she doesn't own yet (dashed: not hers).
          Whether they're on offer depends on the closet, so until it's read their place stays empty. */}
      <View style={[maison.gutter, styles.start]}>
        {closetError ? (
          <Animated.View style={styles.empty} entering={arrive}>
            <Text style={maison.body}>{closetError}</Text>
            <Button kind="outline" label={t('closet.retry')} onPress={retry} />
          </Animated.View>
        ) : items === null ? null : items.length === 0 ? (
          <Animated.View style={styles.empty} entering={arrive}>
            <Text style={maison.body}>{t('styleIt.emptyCloset')}</Text>
            <Button
              kind="outline"
              label={t('styleIt.addFirst')}
              onPress={() => router.push('/add-item')}
            />
          </Animated.View>
        ) : (
          <Animated.View style={styles.buttons} entering={arrive}>
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
          </Animated.View>
        )}
      </View>

      {/* The diary: everything she styled, newest on top, on one thread; the open one grows its
          outfits full width, the others show theirs folded small. */}
      <View
        style={styles.diary}
        testID="diary"
        onLayout={(event) => {
          diaryY.current = event.nativeEvent.layout.y;
        }}
      >
        {entries.length === 0 ? (
          styled === null && styledFailure === null ? (
            <ThreadWaiting />
          ) : diaryError ? (
            // Said once above when the closet failed too.
            !closetError && (
              <Animated.View style={[maison.gutter, styles.empty]} entering={arrive}>
                <Text style={maison.body}>{diaryError}</Text>
                <Button kind="outline" label={t('closet.retry')} onPress={retry} />
              </Animated.View>
            )
          ) : (
            <Animated.Text style={[maison.note, maison.gutter]} entering={arrive}>
              {t('styleIt.historyEmpty')}
            </Animated.Text>
          )
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
                  onDeleted={() => onDeleted(entry.id)}
                />
              </View>
            ) : (
              <DiaryStop
                key={entry.id}
                entry={entry}
                headers={headers}
                joined={index > 0}
                last={index === entries.length - 1}
                now={readAt}
                settleDelay={settled ? undefined : Math.min(index, SETTLING) * STAGGER_STEP}
                onDeleted={() => onDeleted(entry.id)}
                onOpen={() => {
                  // Not hers yet: its own screen, with the verdict and "Add to wishes" / "Add to
                  // my closet", rather than the looks alone.
                  if (entry.loose) {
                    router.push({ pathname: '/wear-with/[id]', params: { id: entry.id } });
                    return;
                  }
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
      </View>

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
  // One line of `maison.note`.
  leftLine: {
    minHeight: 17,
  },
  // As tall as the buttons (`Button`), so the diary doesn't move when they come.
  start: {
    gap: 10,
    minHeight: 52,
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
  empty: {
    gap: 12,
  },
  diary: {
    paddingStart: 6,
    paddingEnd: 20,
  },
});
