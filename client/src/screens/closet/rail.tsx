import type { Item, ItemCategory } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { HANGER_PIVOT_Y } from '@/components/hanger';
import { BeadAcross } from '@/components/thread-stops';
import { arrive, durations, EASE_OUT, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { RailPiece } from './rail-piece';
import { useRailSwing } from './swing';

// Once a deleted piece has dropped, the rest slide together to close its gap.
const closeUp = LinearTransition.duration(durations.state).easing(EASE_OUT);

// Room above the hooks, and where the rail line runs through them.
const TRACK_TOP = 9;
const LINE = 1.4;

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
  onSeeAll: () => void;
};

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
}: Props) {
  const { t } = useTranslation();
  const title = t(`closet.filters.${category}`);
  const shoes = category === 'shoes';
  // Shoes stand still, so their rail has no pendulums to step.
  const { onScroll, swing } = useRailSwing(category, shoes ? [] : items.map((item) => item.id));
  const settle = enterDelay === undefined ? undefined : arrive.delay(enterDelay);

  return (
    <View style={styles.rail}>
      <Animated.View style={styles.head} entering={settle}>
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
        <Pressable
          style={styles.seeAll}
          onPress={onSeeAll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('closet.seeAllOf', { category: title })}
        >
          <Text style={styles.seeAllText}>{t('closet.seeAll')}</Text>
        </Pressable>
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
            <RailLine />
          </Animated.View>
        )}
        <Animated.FlatList
          horizontal
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
    </View>
  );
}

// The rail itself: an ink line across the screen with a bracket at each end. While something is
// waited for a bead runs along it, the one sign of waiting (docs/design.md, "Waiting"). Decoration,
// so screen readers skip it; `style` places it.
export function RailLine({
  waiting,
  style,
}: {
  // Left out on a rail that never waits, which then needn't carry the bead's motion.
  waiting?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.line, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.bracket, styles.bracketStart]} />
      <View style={[styles.bracket, styles.bracketEnd]} />
      {waiting !== undefined && <BeadAcross waiting={waiting} />}
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
      accessibilityLiveRegion="polite"
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
  line: {
    height: LINE,
    backgroundColor: colors.text,
  },
  bracket: {
    position: 'absolute',
    top: -6,
    width: LINE,
    height: 13,
    backgroundColor: colors.text,
  },
  bracketStart: {
    start: 6,
  },
  bracketEnd: {
    end: 6,
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
