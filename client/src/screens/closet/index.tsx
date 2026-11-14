import { ITEM_CATEGORIES, type Item } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScrollTitleBar, useScrollTitle } from '@/components/scroll-title-bar';
import { useTabBarClearance } from '@/components/tab-bar';
import { StyleCard } from '@/components/style-card';
import { useStyle } from '@/lib/style';
import { isLaunching, LAUNCH_HANDOFF_MS } from '@/lib/launch';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { EmptyCloset } from './empty-closet';
import { FoundLine, FoundSheet, useFound } from './found';
import { NewIn } from './new-in';
import { Rail, RailWaiting } from './rail';
import { useCloset } from './use-closet';

// From this many items the newest gets the bright block above the rails.
const NEW_IN_FROM = 6;
// Between the rails settling in; each rail's pieces follow one another by `STAGGER_STEP`.
const RAIL_STEP = 2 * STAGGER_STEP;

// The closet: one clothes rail per category the user has, in the canonical order.
export function Closet() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const { state, items, headers, leaving, retry, confirmDelete } = useCloset();
  const [editing, setEditing] = useState(false);
  const [entered, setEntered] = useState(false);
  // Under the launch curtain: the pieces wait for the hanger's bar to land on the first rail.
  const [launchDelay] = useState(() => (isLaunching() ? LAUNCH_HANDOFF_MS : 0));
  // The big title scrolls away; a frosted bar with the small one comes in over the rails.
  const { scrollY, onScroll } = useScrollTitle();
  // Held here, not in the card: the card unmounts in edit mode.
  const styleCard = useStyle(i18n.language);

  // Leave edit mode when the tab goes out of view.
  useFocusEffect(useCallback(() => () => setEditing(false), []));

  // Once the rails have played their entrance, rails mounted later (a new category) skip it.
  const loading = state.status === 'loading';
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => setEntered(true),
      launchDelay + ITEM_CATEGORIES.length * STAGGER_STEP + durations.enter,
    );
    return () => clearTimeout(timer);
  }, [ready, launchDelay]);

  // Nothing left to edit: leave edit mode by itself.
  const isEditing = editing && items.length > 0;
  const rails = ITEM_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((rail) => rail.items.length > 0);

  // "Look what turned up" (found.tsx): the week's find, once. Its rail flips to it after the rails
  // have come in; only the first two rails do, since further down she may not be looking there,
  // and then the line just comes.
  const { found, seen } = useFound(ready && items.length > 0);
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const foundPiece = found?.piece ?? null;
  const foundIndex = foundPiece
    ? rails.findIndex((rail) => rail.items.some((item) => item.id === foundPiece.id))
    : -1;
  const foundRail = foundIndex >= 0 ? rails[foundIndex]!.category : null;
  const flips = foundIndex >= 0 && foundIndex < 2;
  const foundSaid = foundPiece !== null && (arrivedAt === foundPiece.id || foundIndex >= 2);
  useEffect(() => {
    if (foundSaid) seen();
  }, [foundSaid, seen]);
  // Edit mode only matters before the flip starts: `Rail` seeks a piece once, so turning editing on
  // mid-flip drops `seek` but doesn't stop it, and that's fine (it's 2.4 s; a finger stops it).
  const seek = useMemo(
    () =>
      flips && entered && !isEditing && foundPiece
        ? { itemId: foundPiece.id, onArrived: () => setArrivedAt(foundPiece.id) }
        : undefined,
    [flips, entered, isEditing, foundPiece],
  );

  // A long press is a shortcut into edit mode, the way it is on the home screen.
  const startEditing = () => {
    if (isEditing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(true);
  };

  const open = (item: Item) => router.push({ pathname: '/item/[id]', params: { id: item.id } });

  const editButton = items.length > 0 && (
    <Animated.View entering={arrive}>
      <Pressable
        style={styles.editButton}
        onPress={() => setEditing(!isEditing)}
        hitSlop={8}
        accessibilityRole="button"
      >
        <Text style={styles.editButtonText}>{t(isEditing ? 'closet.done' : 'closet.edit')}</Text>
      </Pressable>
    </Animated.View>
  );

  // A closet of a few items has nothing to feature; the banner would only repeat the rails.
  const newest = items.length >= NEW_IN_FROM ? items[0] : undefined;
  // A closet with nothing in it yet: the first screen she sees, on the blue of something new.
  const empty = ready && items.length === 0;

  const header = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 24 }, empty && styles.headerNew]}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {t('closet.title')}
          </Text>
          {/* The count's line is kept while waiting, so the rail doesn't move when it comes. */}
          {loading && (
            <Text
              style={styles.count}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {' '}
            </Text>
          )}
          {items.length > 0 && (
            <Animated.Text style={styles.count} entering={arrive}>
              {t('items.count', { count: items.length })}
            </Animated.Text>
          )}
        </View>
        {editButton}
      </View>
      {/* Not while waiting: coming in on its own, it would push the waiting rail down. */}
      {ready && !isEditing && <StyleCard {...styleCard} />}
      {newest && !isEditing && (
        <NewIn item={newest} headers={headers} settling={!entered} onPress={() => open(newest)} />
      )}
    </>
  );

  return (
    <View style={styles.screen}>
      {/* One layout for every state (docs/design.md, "Waiting"): the title stays where it is and
          what the closet holds settles in under it; nothing here enters again. */}
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        scrollEnabled={ready}
      >
        {header}
        {loading && <RailWaiting />}

        {state.status === 'error' && (
          <Animated.View style={styles.center} entering={arrive}>
            <Text style={styles.message}>
              {t(state.offline ? 'common.offline' : 'closet.loadError')}
            </Text>
            <Pressable onPress={retry} accessibilityRole="button">
              <Text style={styles.link}>{t('closet.retry')}</Text>
            </Pressable>
          </Animated.View>
        )}

        {empty && <EmptyCloset />}

        {rails.map((rail, index) => (
          <Rail
            key={rail.category}
            category={rail.category}
            items={rail.items}
            headers={headers}
            editing={isEditing}
            leaving={leaving}
            enterDelay={entered ? undefined : launchDelay + index * RAIL_STEP}
            launchTarget={index === 0}
            // A block above the rails pushes the first one down from where the line waited.
            lineStays={index === 0 && !newest}
            onOpen={open}
            onLongPress={startEditing}
            onDelete={confirmDelete}
            onSeeAll={() =>
              router.push({ pathname: '/closet/[category]', params: { category: rail.category } })
            }
            seek={rail.category === foundRail ? seek : undefined}
            below={
              rail.category === foundRail && foundSaid ? (
                <FoundLine onOpen={() => setSheetOpen(true)} />
              ) : undefined
            }
          />
        ))}
      </Animated.ScrollView>
      {found?.piece && (
        <FoundSheet
          found={found}
          headers={headers}
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}

      <ScrollTitleBar title={t('closet.title')} scrollY={scrollY} />
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
  },
  headerNew: {
    backgroundColor: colors.ground,
  },
  heading: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 48,
    lineHeight: 50,
    color: colors.text,
    textAlign: 'left',
  },
  count: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'left',
  },
  editButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  editButtonText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
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
    textDecorationLine: 'underline',
  },
  // Fills the screen, so an empty closet's or a failed load's message can sit in its middle.
  content: {
    flexGrow: 1,
  },
});
