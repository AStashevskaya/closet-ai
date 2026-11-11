import type { ItemCategory } from '@closet-ai/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { HANGERS } from '@/components/hanger';
import { Button } from '@/components/maison';
import { RailLine, RAIL_WEIGHT } from '@/components/rail-line';
import { SilhouetteHanger, type Silhouette } from '@/components/silhouette-hanger';
import { arrive, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

const HANGER = 54;
// What hangs on each rail of an empty closet: the shapes her pieces will take.
const HANGING: { category: ItemCategory; shapes: Silhouette[] }[] = [
  { category: 'top', shapes: ['tee', 'shirt', 'knit', 'coat'] },
  { category: 'bottom', shapes: ['trousers', 'skirt', 'shorts'] },
];
// Shoes stand on the floor, as on her rails: three faint pairs on a 74×40 grid.
const SHOES = [
  'M4 34V20q0-7 7-7h7q5 9 17 11l22 5q10 2 10 9v-4Z',
  'M6 34l3-24h6q3 8 14 10l26 6q8 2 9 8Z',
  'M4 34V12q0-6 6-6h9l3 14 36 6q8 2 8 8Z',
];
const SHOE_WIDTH = 64;
const FAINT = 0.34;

// An empty closet (decided 2026-11-11, prototype `~/Desktop/closet/wrinkle-lab/design-empty`,
// direction A on powder blue): the rail from sign-up, now one per kind of piece, faint shapes on
// its hangers, on the blue of something new. A tap on a shape adds a piece to that rail; the
// button and the link under it add one or several. The blue band goes with the first piece.
export function EmptyCloset() {
  const { t } = useTranslation();
  const router = useRouter();
  const add = (params: { category?: ItemCategory; source?: 'library' }) =>
    router.push({ pathname: '/add-item', params });

  return (
    <>
      <View style={styles.band}>
        <Animated.Text style={styles.note} entering={arrive}>
          {t('closet.emptyNote')}
        </Animated.Text>
        {HANGING.map(({ category, shapes }, rail) => (
          <Animated.View
            key={category}
            style={styles.rail}
            entering={arrive.delay((rail + 1) * 2 * STAGGER_STEP)}
          >
            <Text style={styles.title} accessibilityRole="header">
              {t(`closet.filters.${category}`)}
            </Text>
            <View style={styles.track}>
              <RailLine style={styles.line} />
              {shapes.map((shape, index) => (
                <Pressable
                  key={shape}
                  onPress={() => add({ category })}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t('closet.emptyRail', {
                    rail: t(`closet.filters.${category}`),
                  })}
                  // One button per rail is enough for a screen reader; the others repeat it.
                  accessibilityElementsHidden={index > 0}
                  importantForAccessibility={index > 0 ? 'no-hide-descendants' : 'auto'}
                >
                  <SilhouetteHanger
                    shape={shape}
                    index={rail * 2 + index}
                    filled
                    kind={HANGERS[category]}
                    width={HANGER}
                    testID="empty-closet-piece"
                  />
                </Pressable>
              ))}
            </View>
          </Animated.View>
        ))}
        <Animated.View style={styles.rail} entering={arrive.delay(6 * STAGGER_STEP)}>
          <Text style={styles.title} accessibilityRole="header">
            {t('closet.filters.shoes')}
          </Text>
          <Pressable
            style={styles.shoes}
            onPress={() => add({ category: 'shoes' })}
            accessibilityRole="button"
            accessibilityLabel={t('closet.emptyRail', { rail: t('closet.filters.shoes') })}
          >
            {SHOES.map((shoe) => (
              <Svg
                key={shoe}
                width={SHOE_WIDTH}
                height={(SHOE_WIDTH * 40) / 74}
                viewBox="0 0 74 40"
                fill={colors.iconMuted}
                opacity={FAINT}
                aria-hidden
              >
                <Path d={shoe} />
              </Svg>
            ))}
          </Pressable>
          {/* Decoration: the floor the shoes stand on. */}
          <View
            style={styles.floor}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </Animated.View>
      </View>
      <Animated.View style={styles.actions} entering={arrive.delay(8 * STAGGER_STEP)}>
        <Button
          kind="bright"
          label={t('closet.emptyShoot')}
          onPress={() => add({})}
          style={styles.button}
        />
        <Pressable
          style={styles.link}
          onPress={() => add({ source: 'library' })}
          accessibilityRole="button"
        >
          <Text style={styles.linkText}>{t('closet.emptyGallery')}</Text>
        </Pressable>
      </Animated.View>
    </>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  // The blue goes on under the title from the screen above (see `header` in index.tsx).
  band: {
    backgroundColor: colors.ground,
    paddingBottom: 24,
  },
  note: {
    fontFamily: fonts.hand,
    fontSize: 21,
    lineHeight: 26,
    color: colors.textSecondary,
    paddingHorizontal: 16,
    marginTop: -10,
    textAlign: 'left',
  },
  rail: {
    marginTop: 18,
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
    paddingHorizontal: 16,
    textAlign: 'left',
  },
  track: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingTop: 8,
    height: 124,
  },
  // Runs through the hooks, edge to edge.
  line: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: 8 + 2 - RAIL_WEIGHT / 2,
  },
  shoes: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  floor: {
    height: RAIL_WEIGHT,
    marginTop: 2,
    backgroundColor: colors.text,
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 22,
    alignItems: 'center',
    gap: 4,
  },
  button: {
    alignSelf: 'stretch',
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
