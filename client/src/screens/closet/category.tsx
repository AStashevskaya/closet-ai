import { ITEM_COLORS, type Item, type ItemCategory, type ItemColor } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { MULTICOLOR, SWATCHES } from '@/components/chip';
import { ScreenTitle } from '@/components/maison';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { Rail, RailWaiting } from './rail';
import { useCloset } from './use-closet';

// Between the rails settling in; each rail's pieces follow one another by `STAGGER_STEP`.
const RAIL_STEP = 2 * STAGGER_STEP;
// The line about her colours needs enough pieces to say something.
const SUMMARY_FROM = 4;
// "Not a single white one" is only worth saying of a closet with a few pieces in the category.
const MISSING_FROM = 6;
// The colours a category is usually built on: their absence is worth a word, a missing yellow isn't.
const BASICS: ItemColor[] = ['black', 'white', 'beige', 'gray'];

export type ColourRail = { colour: ItemColor; items: Item[] };

// A category's pieces by colour, the colour she has most of first (then in the palette's order).
// A piece hangs on the rail of its first colour, the main one as tagged.
export function byColour(items: Item[]): ColourRail[] {
  const groups = new Map<ItemColor, Item[]>();
  for (const item of items) {
    const colour = item.colors[0] ?? 'multicolor';
    groups.set(colour, [...(groups.get(colour) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([colour, pieces]) => ({ colour, items: pieces }))
    .sort(
      (a, b) =>
        b.items.length - a.items.length ||
        ITEM_COLORS.indexOf(a.colour) - ITEM_COLORS.indexOf(b.colour),
    );
}

// "See all" from a closet rail, decided 2026-11-12 (owner, prototype
// `~/Desktop/closet/wrinkle-lab/design-see-all`, C with B's gesture): every piece of one category
// on one rail per colour, a line by hand on blue saying what her colours are, and a light tick for
// each hanger a finger moves past. Edit mode as in the closet. While the closet loads, the bead runs
// on the first rail's line under the title (docs/design.md, "Waiting").
export function ClosetCategory({ category }: { category: ItemCategory }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, items, headers, leaving, retry, confirmDelete } = useCloset();
  const [editing, setEditing] = useState(false);
  const [entered, setEntered] = useState(false);

  useFocusEffect(useCallback(() => () => setEditing(false), []));

  const pieces = items.filter((item) => item.category === category);
  const rails = byColour(pieces);
  const ready = state.status === 'ready';
  const empty = ready && pieces.length === 0;
  // The last piece was deleted (here or elsewhere): the category has nothing left to show.
  useEffect(() => {
    if (empty && router.canGoBack()) router.back();
  }, [empty, router]);

  // Once the rails have played their entrance, a rail mounted later (a new colour) skips it.
  useEffect(() => {
    if (!ready) return;
    // The last colour's rail starts at most this late (one per palette colour).
    const timer = setTimeout(
      () => setEntered(true),
      ITEM_COLORS.length * RAIL_STEP + durations.enter,
    );
    return () => clearTimeout(timer);
  }, [ready]);

  const isEditing = editing && pieces.length > 0;
  const startEditing = () => {
    if (isEditing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(true);
  };
  const open = (item: Item) => router.push({ pathname: '/item/[id]', params: { id: item.id } });
  // Kept in edit mode too: going would move every rail up under the finger aiming at a badge.
  const summary = ready ? summaryOf(rails, pieces) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} scrollEnabled={ready}>
      <View style={styles.header}>
        <View style={styles.heading}>
          {/* The count's line is kept while waiting, so the rail doesn't move when it comes. */}
          <ScreenTitle
            title={t(`closet.filters.${category}`)}
            subtitle={ready ? t('items.count', { count: pieces.length }) : ' '}
          />
        </View>
        {pieces.length > 0 && (
          <Animated.View entering={arrive}>
            <Pressable
              style={styles.editButton}
              onPress={() => setEditing(!isEditing)}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.editButtonText}>
                {t(isEditing ? 'closet.done' : 'closet.edit')}
              </Text>
            </Pressable>
          </Animated.View>
        )}
      </View>

      {state.status === 'loading' && <RailWaiting />}

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

      {empty && (
        <Animated.View style={styles.center} entering={arrive}>
          <Text style={styles.message}>{t('closet.emptyCategory')}</Text>
        </Animated.View>
      )}

      {/* An editorial block (docs/design.md, blue): what her colours say, in her stylist's hand. */}
      {summary && (
        <Animated.View style={styles.band} entering={arrive}>
          <Text style={styles.bandText}>{summary(t)}</Text>
        </Animated.View>
      )}

      {rails.map((rail, index) => (
        <Rail
          key={rail.colour}
          category={category}
          items={rail.items}
          headers={headers}
          editing={isEditing}
          leaving={leaving}
          enterDelay={entered ? undefined : index * RAIL_STEP}
          lineStays={index === 0 && !summary}
          ticks
          heading={<ColourHeading colour={rail.colour} count={rail.items.length} />}
          onOpen={open}
          onLongPress={startEditing}
          onDelete={confirmDelete}
        />
      ))}
    </ScrollView>
  );
}

type T = ReturnType<typeof useTranslation>['t'];

// What her colours say: the one or two she has most of, and the basics she has none of.
function summaryOf(rails: ColourRail[], pieces: Item[]): ((t: T) => string) | null {
  if (pieces.length < SUMMARY_FROM || rails.length === 0) return null;
  const [first, second] = rails;
  // Absent from every piece, not only as the main colour: a black-and-white top has white.
  const missing =
    pieces.length >= MISSING_FROM
      ? BASICS.filter((colour) => !pieces.some((piece) => piece.colors.includes(colour))).slice(
          0,
          2,
        )
      : [];
  return (t) => {
    const of = (colour: ItemColor) => t(`closet.colours.of.${colour}`);
    const most =
      first && second && second.items.length >= 2
        ? t('closet.colours.most', { a: of(first.colour), b: of(second.colour) })
        : t('closet.colours.mostOne', { a: of(first!.colour) });
    const none =
      missing.length === 2
        ? t('closet.colours.noneTwo', { a: of(missing[0]!), b: of(missing[1]!) })
        : missing.length === 1
          ? t('closet.colours.noneOne', { a: of(missing[0]!) })
          : '';
    return none ? `${most} ${none}` : most;
  };
}

// A colour's rail: its swatch, its name by hand, how many.
function ColourHeading({ colour, count }: { colour: ItemColor; count: number }) {
  const { t } = useTranslation();
  const name = t(`closet.colours.rail.${colour}`);
  return (
    <View
      style={styles.colourHead}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${name}, ${t('items.count', { count })}`}
    >
      {colour === 'multicolor' ? (
        <View style={[styles.swatch, styles.multicolor]}>
          {MULTICOLOR.map((c) => (
            <View key={c} style={[styles.stripe, { backgroundColor: c }]} />
          ))}
        </View>
      ) : (
        <View style={[styles.swatch, { backgroundColor: SWATCHES[colour] }]} />
      )}
      <Text style={styles.colourName}>{name}</Text>
      <Text style={styles.colourCount}>· {count}</Text>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 48,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  heading: {
    flex: 1,
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
  band: {
    backgroundColor: colors.ground,
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginTop: 8,
    marginBottom: 22,
  },
  bandText: {
    fontFamily: fonts.hand,
    fontSize: 22,
    lineHeight: 29,
    color: colors.text,
    textAlign: 'left',
  },
  colourHead: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted,
  },
  multicolor: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  stripe: {
    flex: 1,
  },
  colourName: {
    fontFamily: fonts.hand,
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
  },
  colourCount: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  // In the list, which doesn't stretch it: a space above rather than centred.
  center: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 96,
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
});
