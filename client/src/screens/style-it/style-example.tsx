import type { ItemCategory } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { OutfitMobile, type MobilePiece } from '@/components/outfit-mobile';
import { maison } from '@/components/maison';
import { arrive, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// The example's pieces, from the demo catalog (`server/seed/catalog`, STUDIO EDIT), shipped with
// the app so the example needs no network and no AI.
const PIECES = {
  P016: { category: 'outerwear', image: require('../../../assets/example/P016.webp') },
  P006: { category: 'top', image: require('../../../assets/example/P006.webp') },
  P037: { category: 'bottom', image: require('../../../assets/example/P037.webp') },
  P078: { category: 'shoes', image: require('../../../assets/example/P078.webp') },
  P064: { category: 'accessory', image: require('../../../assets/example/P064.webp') },
  P004: { category: 'top', image: require('../../../assets/example/P004.webp') },
  P026: { category: 'bottom', image: require('../../../assets/example/P026.webp') },
  P077: { category: 'shoes', image: require('../../../assets/example/P077.webp') },
  P066: { category: 'accessory', image: require('../../../assets/example/P066.webp') },
  P056: { category: 'top', image: require('../../../assets/example/P056.webp') },
  P031: { category: 'bottom', image: require('../../../assets/example/P031.webp') },
  P075: { category: 'shoes', image: require('../../../assets/example/P075.webp') },
  P061: { category: 'accessory', image: require('../../../assets/example/P061.webp') },
} satisfies Record<string, { category: ItemCategory; image: number }>;
type PieceId = keyof typeof PIECES;

const HERO: PieceId = 'P016';
// Three looks around the blazer, put together by hand (owner, 2026-11-11).
const LOOKS: { key: 'easy' | 'out' | 'bold'; pieces: PieceId[] }[] = [
  { key: 'easy', pieces: ['P016', 'P006', 'P037', 'P078', 'P064'] },
  { key: 'out', pieces: ['P016', 'P004', 'P026', 'P077', 'P066'] },
  { key: 'bold', pieces: ['P016', 'P056', 'P031', 'P075', 'P061'] },
];
const LOOK_WIDTH = 236;

// What Style it does, before she has asked for anything (decided 2026-11-11, prototype
// `~/Desktop/closet/wrinkle-lab/design-empty`): a piece as a tilted print with "example" by hand,
// and its three looks hanging as mobiles, as her own will. Not hers, so on dashed strings.
export function StyleExample() {
  const { t } = useTranslation();
  const piece = (id: PieceId): MobilePiece => ({
    id,
    name: t(`styleIt.example.pieces.${id}`),
    category: PIECES[id].category,
    image: PIECES[id].image,
    loose: true,
  });

  return (
    <Animated.View entering={arrive} testID="style-example">
      <View style={[maison.gutter, styles.hero]}>
        <View style={styles.print}>
          <Image
            source={PIECES[HERO].image}
            style={styles.heroImage}
            contentFit="contain"
            accessibilityLabel={t(`styleIt.example.pieces.${HERO}`)}
          />
        </View>
        <Text style={styles.stamp}>{t('styleIt.example.stamp')}</Text>
        <View style={styles.words}>
          <Text style={maison.body}>{t('styleIt.example.lead')}</Text>
          <Text style={[maison.note, styles.source]}>{t('styleIt.example.source')}</Text>
        </View>
      </View>
      {/* Decoration: the thread from the piece to its looks. */}
      <View
        style={styles.thread}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.looks}
        snapToInterval={LOOK_WIDTH + 20}
        decelerationRate="fast"
      >
        {LOOKS.map((look, index) => (
          <Animated.View
            key={look.key}
            style={styles.look}
            entering={arrive.delay((index + 1) * 2 * STAGGER_STEP)}
          >
            <OutfitMobile
              pieces={look.pieces.map(piece)}
              headers={undefined}
              caption={t(`styleIt.example.looks.${look.key}`)}
              seed={index + 1}
            />
          </Animated.View>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  // A piece that isn't hers: a white-bordered print, the hero one tilted (docs/design.md).
  print: {
    width: 104,
    height: 128,
    padding: 6,
    backgroundColor: colors.paper,
    transform: [{ rotate: '-3deg' }],
    shadowColor: colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroImage: {
    flex: 1,
  },
  stamp: {
    position: 'absolute',
    top: -14,
    start: 92,
    fontFamily: fonts.hand,
    fontSize: 20,
    color: colors.bead,
    transform: [{ rotate: '-6deg' }],
  },
  words: {
    flex: 1,
    gap: 6,
  },
  source: {
    textAlign: 'left',
  },
  thread: {
    marginStart: 72,
    height: 26,
    borderStartWidth: 1.2,
    borderColor: colors.text,
  },
  looks: {
    paddingHorizontal: 20,
    gap: 20,
  },
  look: {
    width: LOOK_WIDTH,
  },
});
