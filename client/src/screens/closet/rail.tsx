import type { Item, ItemCategory } from '@closet-ai/shared';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  I18nManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeOut,
  LinearTransition,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { HANGER_PIVOT_Y } from '@/components/hanger';
import { RAIL_WEIGHT, RailLine } from '@/components/rail-line';
import { isLaunching, offerLaunchRail } from '@/lib/launch';
import { arrive, durations, EASE_OUT, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { pieceMiddle, pieceStep, RailPiece } from './rail-piece';
import { useRailSwing } from './swing';

// Once a deleted piece has dropped, the rest slide together to close its gap.
const closeUp = LinearTransition.duration(durations.state).easing(EASE_OUT);

// Room above the hooks, and where the rail line runs through them.
const TRACK_TOP = 9;
const LINE = RAIL_WEIGHT;
// Where the track's first piece starts (the track's padding).
const TRACK_START = 22;

type Props = {
  category: ItemCategory;
  items: Item[];
  headers: Record<string, string> | undefined;
  editing: boolean;
  leaving: ReadonlySet<string>;
  // Only set on the first load: the rail's parts settle in, and don't again when the closet reloads.
  enterDelay?: number;
  // The line was already there while the closet loaded, at this very place: it doesn't arrive.
  lineStays?: boolean;
  onOpen: (item: Item) => void;
  onLongPress: () => void;
  onDelete: (item: Item) => void;
  // Opens the whole category; without it, no "See all".
  onSeeAll?: () => void;
  // In place of the category's name and count: a colour's rail in "See all".
  heading?: ReactNode;
  // A light tick for each hanger a finger moves past.
  ticks?: boolean;
  // The first rail on screen at launch: the launch hanger's bar lands on its line.
  launchTarget?: boolean;
  // "Look what turned up": the rail flips through its hangers by itself and stops with this piece
  // in the middle, then says so. Once per piece.
  seek?: { itemId: string; onArrived: () => void };
  // Under the rail: what the found piece says.
  below?: ReactNode;
};

// The flip through the hangers: from about seven before the piece, slowing onto it (the owner
// chose the slow one in the prototype, 2026-11-12).
const SEEK_MS = 2400;
const SEEK_FROM = 7;
const seekEasing = Easing.bezier(0.22, 1, 0.36, 1);

// One category of the closet as a clothes rail: an ink line across the screen with the pieces
// hanging from it, scrolled sideways; they swing as it moves. Shoes stand on a floor line instead.
// "See all" opens the whole category, so a big closet isn't stuck behind sideways scrolling.
export function Rail({
  category,
  items,
  headers,
  editing,
  leaving,
  enterDelay,
  lineStays = false,
  onOpen,
  onLongPress,
  onDelete,
  onSeeAll,
  heading,
  ticks = false,
  launchTarget = false,
  seek,
  below,
}: Props) {
  const { t } = useTranslation();
  const title = t(`closet.filters.${category}`);
  const shoes = category === 'shoes';
  const reduced = useReducedMotion();
  const { width: screen } = useWindowDimensions();
  const list = useAnimatedRef<FlatList<Item>>();
  const [contentWidth, setContentWidth] = useState(0);
  const seeking = useSharedValue(0);
  const from = useSharedValue(0);
  const to = useSharedValue(0);
  const flipping = useSharedValue(false);
  // Which piece the rail went to, so it goes once; and whether it has said so yet.
  const sought = useRef<string | null>(null);
  const arrived = useRef(false);
  const land = useCallback(() => {
    if (arrived.current) return;
    arrived.current = true;
    seek?.onArrived();
  }, [seek]);
  // Shoes stand still, so their rail has no pendulums to step. A finger on the rail mid-flip stops
  // the flip on the UI thread (swing.ts); she has it, and `land` brings the line.
  const { onScroll, swing, guide } = useRailSwing(
    category,
    shoes ? [] : items.map((item) => item.id),
    ticks ? pieceStep(category) : undefined,
    { flipping, progress: seeking },
    land,
  );
  // Leaving the closet mid-flip: the flip stops with it and says nothing to a rail that's gone.
  useEffect(
    () => () => {
      flipping.set(false);
      cancelAnimation(seeking);
    },
    [flipping, seeking],
  );
  useAnimatedReaction(
    () => seeking.get(),
    (p) => {
      if (flipping.get()) scrollTo(list, from.get() + (to.get() - from.get()) * p, 0, false);
    },
  );
  useEffect(() => {
    if (!seek || sought.current === seek.itemId) return;
    // The flip needs the track's length to know where it ends; standing still doesn't.
    if (contentWidth === 0 && !reduced) return;
    const index = items.findIndex((item) => item.id === seek.itemId);
    if (index < 0) return;
    sought.current = seek.itemId;
    arrived.current = false;
    // Without the track's length it can't be placed safely: the rail stays and the line comes.
    if (contentWidth === 0) {
      land();
      return;
    }
    const end = Math.max(0, contentWidth - screen);
    const along = (x: number) => Math.min(end, Math.max(0, x));
    // Along the reading direction, from the rail's start. On Android in RTL a horizontal list's
    // offset still counts from the left edge, where its end is; iOS mirrors it, so there the
    // offset counts from the start as in LTR.
    const offsetOf = (x: number) =>
      I18nManager.isRTL && Platform.OS === 'android' ? end - along(x) : along(x);
    const target = TRACK_START + pieceMiddle(category, index) - screen / 2;
    const done = () => {
      guide(false);
      flipping.set(false);
      land();
    };
    if (reduced) {
      const there = offsetOf(target);
      scheduleOnUI(() => {
        'worklet';
        scrollTo(list, there, 0, false);
      });
      land();
      return;
    }
    from.set(offsetOf(target - SEEK_FROM * pieceStep(category)));
    to.set(offsetOf(target));
    scheduleOnUI(() => {
      'worklet';
      scrollTo(list, from.get(), 0, false);
    });
    flipping.set(true);
    guide(true);
    seeking.set(0);
    seeking.set(
      withTiming(1, { duration: SEEK_MS, easing: seekEasing }, (finished) => {
        if (finished) scheduleOnRN(done);
      }),
    );
  }, [
    seek,
    contentWidth,
    items,
    category,
    screen,
    reduced,
    list,
    from,
    to,
    seeking,
    flipping,
    guide,
    land,
  ]);
  const settle = enterDelay === undefined ? undefined : arrive.delay(enterDelay);
  const line = useRef<ComponentRef<typeof View>>(null);
  // The launch hanger's bar lands here: it measures the line when it lands.
  useEffect(() => {
    if (!launchTarget || !isLaunching()) return;
    return offerLaunchRail((done) =>
      line.current?.measureInWindow((_x, y, _width, lineHeight) => done(y + lineHeight / 2)),
    );
  }, [launchTarget]);

  return (
    <View style={styles.rail}>
      <Animated.View style={styles.head} entering={settle}>
        {heading ?? (
          <Text
            style={styles.title}
            accessibilityRole="header"
            accessibilityLabel={`${title}, ${t('items.count', { count: items.length })}`}
          >
            {title}
            <Text style={styles.count}>
              {'  '}
              {items.length}
            </Text>
          </Text>
        )}
        {onSeeAll && (
          <Pressable
            style={styles.seeAll}
            onPress={onSeeAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('closet.seeAllOf', { category: title })}
          >
            <Text style={styles.seeAllText}>{t('closet.seeAll')}</Text>
          </Pressable>
        )}
      </Animated.View>

      <View>
        {shoes ? (
          // Decoration: the floor shoes stand on.
          <Animated.View
            style={styles.floor}
            entering={settle}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : (
          <Animated.View style={styles.linePlace} entering={lineStays ? undefined : settle}>
            <View ref={line} collapsable={false}>
              <RailLine />
            </View>
          </Animated.View>
        )}
        <Animated.FlatList
          ref={list}
          horizontal
          onContentSizeChange={(contentW) => setContentWidth(contentW)}
          onScroll={onScroll}
          scrollEventThrottle={16}
          itemLayoutAnimation={closeUp}
          data={items}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={shoes ? styles.floorTrack : styles.track}
          initialNumToRender={5}
          windowSize={5}
          extraData={{ editing, leaving, headers }}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={
                enterDelay === undefined
                  ? undefined
                  : arrive.delay(enterDelay + index * STAGGER_STEP)
              }
            >
              <RailPiece
                item={item}
                headers={headers}
                editing={editing}
                leaving={leaving.has(item.id)}
                swing={swing}
                onPress={editing ? undefined : () => onOpen(item)}
                onLongPress={onLongPress}
                onDelete={() => onDelete(item)}
              />
            </Animated.View>
          )}
        />
      </View>
      {below}
    </View>
  );
}

// The closet still loading: the first rail's place, its line where the line will hang. The
// categories aren't known yet, so no name and no second rail. It goes with a short fade over the
// real rail's line, which comes at this same place when nothing is featured above the rails.
export function RailWaiting() {
  const { t } = useTranslation();
  return (
    <Animated.View
      testID="rail-waiting"
      style={styles.rail}
      exiting={FadeOut.duration(durations.state)}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
    >
      <View style={styles.headWaiting} />
      <View style={styles.trackWaiting}>
        <View style={styles.linePlace}>
          <RailLine waiting />
        </View>
      </View>
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  rail: {
    marginBottom: 26,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  title: {
    flex: 1,
    fontFamily: fonts.displayLight,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'left',
  },
  count: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  seeAll: {
    minHeight: 44,
    justifyContent: 'center',
  },
  seeAllText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  track: {
    paddingTop: TRACK_TOP,
    paddingBottom: 8,
    paddingHorizontal: 22,
  },
  floorTrack: {
    paddingTop: 6,
    paddingBottom: 4,
    paddingHorizontal: 22,
  },
  // A rail's head without its name, as tall as one with it.
  headWaiting: {
    minHeight: 44,
  },
  trackWaiting: {
    height: TRACK_TOP + HANGER_PIVOT_Y + 16,
  },
  // Runs through the hooks, edge to edge.
  linePlace: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: TRACK_TOP + HANGER_PIVOT_Y - LINE / 2,
  },
  floor: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 2,
    height: LINE,
    backgroundColor: colors.text,
  },
});
