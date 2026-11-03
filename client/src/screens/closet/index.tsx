import { ITEM_CATEGORIES, type Item } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTabBarClearance } from '@/components/tab-bar';
import { StyleCard } from '@/components/style-card';
import { useStyle } from '@/lib/style';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

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
  const scrollY = useSharedValue(0);
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
      ITEM_CATEGORIES.length * STAGGER_STEP + durations.enter,
    );
    return () => clearTimeout(timer);
  }, [ready]);

  // Nothing left to edit: leave edit mode by itself.
  const isEditing = editing && items.length > 0;
  const rails = ITEM_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((rail) => rail.items.length > 0);

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

  // The big title scrolls away; a frosted bar with the small one comes in over the rails.
  const bar = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [60, 120], [0, 1], Extrapolation.CLAMP),
  }));
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  // A closet of a few items has nothing to feature; the banner would only repeat the rails.
  const newest = items.length >= NEW_IN_FROM ? items[0] : undefined;

  const header = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
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
        scrollEnabled={items.length > 0}
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

        {ready && items.length === 0 && (
          <Animated.View style={styles.center} entering={arrive}>
            <Text style={styles.message}>{t('closet.empty')}</Text>
          </Animated.View>
        )}

        {rails.map((rail, index) => (
          <Rail
            key={rail.category}
            category={rail.category}
            items={rail.items}
            headers={headers}
            editing={isEditing}
            leaving={leaving}
            enterDelay={entered ? undefined : index * RAIL_STEP}
            // A block above the rails pushes the first one down from where the line waited.
            lineStays={index === 0 && !newest}
            onOpen={open}
            onLongPress={startEditing}
            onDelete={confirmDelete}
            onSeeAll={() =>
              router.push({ pathname: '/closet/[category]', params: { category: rail.category } })
            }
          />
        ))}
      </Animated.ScrollView>

      {/* Decoration only: the big title above is the heading screen readers get. */}
      <Animated.View
        style={[styles.bar, { height: insets.top + 48 }, bar]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <BlurView
          intensity={70}
          tint="light"
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, styles.barGlass]}
        />
        <View style={[styles.barRow, { paddingTop: insets.top }]}>
          <Text style={styles.barTitle}>{t('closet.title')}</Text>
        </View>
      </Animated.View>
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
  // The frosted bar over the rails once the big title has scrolled away.
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  barGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.06)',
  },
  barRow: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
  },
});
