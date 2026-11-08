import type { CatalogFeedItem } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { cutoutShadow } from '@/components/cutout-shadow';
import { maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl } from '@/lib/api';
import { priceLabel } from '@/lib/price';
import { colors, fonts } from '@/theme';

// One page of the issue (docs/design.md, "The Edit"): a piece large, on either side in turn, and a
// dashed thread to the piece of hers it goes with: dashed because the brand's piece isn't hers.
// A piece that goes with nothing of hers has no thread: a thread always connects two things.
const HEAD_HEIGHT = 32;
const MAIN_WIDTH = 252;
const MAIN_HEIGHT = 300;
const MAIN_OVERHANG = -6;
const HERS_SIZE = 84;
const HERS_TOP = 236;
const HERS_INSET = 26;
const NOTE_TOP = 322;
// Room for the handwriting's two lines under her piece, or for nothing.
const FOOT_TOP_PAIRED = 396;
const FOOT_TOP_ALONE = 334;

// From the large piece's edge across to the top of hers, drawn for a piece on the start side.
function threadPath(width: number) {
  const hers = width - HERS_INSET - HERS_SIZE / 2;
  return `M196 210 C${hers - 48} 190 ${hers} 200 ${hers} ${HERS_TOP + 2}`;
}

type Props = {
  item: CatalogFeedItem;
  headers: Record<string, string>;
  width: number;
  // Every other page has the large piece on the end side.
  flipped: boolean;
  onPress: () => void;
};

export function Spread({ item, headers, width, flipped, onPress }: Props) {
  const { t } = useTranslation();
  const price = priceLabel(item.price, item.currency);
  const pair = item.goesWith;
  const goesWith = pair ? t('edit.goesWith', { count: pair.count }) : null;
  // An SVG's own coordinates don't follow the layout direction, so RTL mirrors it too.
  const mirrored = flipped !== I18nManager.isRTL;

  return (
    <PressableScale
      style={styles.spread}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[`${item.brand}, ${item.name}, ${price}`, goesWith]
        .filter(Boolean)
        .join('. ')}
    >
      {pair && (
        <Svg
          width={width}
          height={FOOT_TOP_PAIRED}
          style={[styles.thread, mirrored && styles.mirrored]}
        >
          <Path
            d={threadPath(width)}
            stroke={colors.textMuted}
            strokeWidth={1}
            strokeDasharray={[3, 4]}
            fill="none"
          />
        </Svg>
      )}

      <View style={[styles.head, maison.gutter]}>
        <Text style={styles.brand}>{item.brand}</Text>
        <Text style={styles.price}>{price}</Text>
      </View>

      <View
        style={[styles.main, flipped ? styles.mainFlipped : styles.mainPlain, cutoutShadow('flat')]}
      >
        <Image
          source={{ uri: absoluteUrl(item.imageUrl), headers }}
          style={styles.fill}
          contentFit="contain"
          transition={200}
          accessibilityIgnoresInvertColors
        />
      </View>

      {pair && (
        <>
          <View
            style={[
              styles.hers,
              flipped ? styles.hersFlipped : styles.hersPlain,
              cutoutShadow('flat'),
            ]}
          >
            <Image
              source={{ uri: absoluteUrl(pair.piece.cutoutUrl), headers }}
              style={styles.fill}
              contentFit="contain"
              transition={200}
              accessibilityIgnoresInvertColors
            />
          </View>
          <Text
            style={[styles.note, flipped ? styles.noteFlipped : styles.notePlain]}
            numberOfLines={2}
          >
            {t('edit.toYour', { name: pair.piece.name })}
          </Text>
        </>
      )}

      <View style={[styles.foot, { marginTop: pair ? FOOT_TOP_PAIRED : FOOT_TOP_ALONE }]}>
        <Text style={styles.name} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.label}>{t(item.demo ? 'partner.demoLabel' : 'partner.label')}</Text>
        {goesWith && (
          <View style={styles.goesWith}>
            <Text style={styles.goesWithText}>{goesWith}</Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start.
const styles = StyleSheet.create({
  spread: {
    paddingBottom: 26,
  },
  thread: {
    position: 'absolute',
    top: 0,
    start: 0,
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  head: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    height: HEAD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  price: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  fill: {
    flex: 1,
  },
  main: {
    position: 'absolute',
    top: HEAD_HEIGHT - 10,
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
  },
  mainPlain: { start: MAIN_OVERHANG },
  mainFlipped: { end: MAIN_OVERHANG },
  hers: {
    position: 'absolute',
    top: HERS_TOP,
    width: HERS_SIZE,
    height: HERS_SIZE,
  },
  hersPlain: { end: HERS_INSET },
  hersFlipped: { start: HERS_INSET },
  note: {
    position: 'absolute',
    top: NOTE_TOP,
    width: 130,
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notePlain: { end: 14 },
  noteFlipped: { start: 14 },
  foot: {
    marginHorizontal: 20,
    gap: 6,
    alignItems: 'flex-start',
  },
  name: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  label: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.bead,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onBead,
  },
  goesWith: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.ground,
  },
  goesWithText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
  },
});
