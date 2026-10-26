import type { Item, ItemCategory } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { HANGER_PIVOT_Y } from '@/components/hanger';
import { durations, EASE_OUT, rise } from '@/motion';
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
  // Only set on the first load, so rails don't replay their entrance when the closet reloads.
  enterDelay?: number;
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

  return (
    <Animated.View
      style={styles.rail}
      entering={enterDelay === undefined ? undefined : rise.delay(enterDelay)}
    >
      <View style={styles.head}>
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
      </View>

      <View>
        {/* Decoration: the rail with a bracket at each end, or the floor shoes stand on. */}
        <View
          style={shoes ? styles.floor : styles.line}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {!shoes && (
            <>
              <View style={[styles.bracket, styles.bracketStart]} />
              <View style={[styles.bracket, styles.bracketEnd]} />
            </>
          )}
        </View>
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
          renderItem={({ item }) => (
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
          )}
        />
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
  // Runs through the hooks, edge to edge.
  line: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: TRACK_TOP + HANGER_PIVOT_Y - LINE / 2,
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
