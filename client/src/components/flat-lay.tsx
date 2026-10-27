import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { cutoutShadow } from '@/components/cutout-shadow';
import { HandDrawn } from '@/components/hand-drawn';
import { absoluteUrl } from '@/lib/api';
import { colors, fonts } from '@/theme';

type Piece = Pick<Item, 'id' | 'name' | 'category' | 'photoUrl' | 'cutoutUrl'>;

type Props = {
  pieces: Piece[];
  headers: Record<string, string> | undefined;
  // Handwritten name of the look.
  caption: string;
  // A look the user loves gets a heart drawn around it with the thread, behind the pieces.
  loved?: boolean;
  // Any number, the same for the same look, so its heart keeps its shape.
  seed?: number;
};

// Where each kind of piece lies on the square sheet: start and top in %, width in % (pieces
// are 3:4), a slight turn. As if laid out to wear: a layer to the side, the top above the
// bottom, shoes and a bag below. The bottom fifth is left for the caption.
type Spot = { start: number; top: number; width: number; turn: number };
const spot = (start: number, top: number, width: number, turn: number): Spot => ({
  start,
  top,
  width,
  turn,
});
const SPOTS: Record<Item['category'], Spot[]> = {
  // A second layer or accessory (a partner jacket next to hers, a hat next to the bag) gets a
  // place of its own instead of lying on the first.
  outerwear: [spot(2, 6, 40, -6), spot(58, 2, 38, 6)],
  top: [spot(30, 0, 40, -2), spot(62, 8, 34, 6)],
  dress: [spot(28, 2, 46, -1)],
  bottom: [spot(32, 34, 38, 2)],
  shoes: [spot(64, 54, 28, -4)],
  accessory: [spot(4, 58, 24, 5), spot(4, 30, 20, -8)],
};

// Layers first, so the base pieces lie on top of them.
const ORDER: Item['category'][] = ['outerwear', 'dress', 'top', 'bottom', 'shoes', 'accessory'];

export function layOut(pieces: Piece[]): [Piece, Spot][] {
  const used: Partial<Record<Item['category'], number>> = {};
  return [...pieces]
    .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))
    .map((piece) => {
      const spots = SPOTS[piece.category];
      const index = Math.min(used[piece.category] ?? 0, spots.length - 1);
      used[piece.category] = (used[piece.category] ?? 0) + 1;
      return [piece, spots[index]!];
    });
}

// An outfit laid flat on paper with its name handwritten, like the Want / Can collage.
export function FlatLay({ pieces, headers, caption, loved = false, seed = 1 }: Props) {
  return (
    <View style={styles.sheet} accessible accessibilityLabel={caption}>
      <HandDrawn shape="heart" drawn={loved} seed={seed} fill style={styles.heart} />
      {layOut(pieces).map(([piece, { start, top, width, turn }]) => {
        const url = piece.cutoutUrl ?? piece.photoUrl;
        return (
          <View
            key={piece.id}
            style={[
              styles.piece,
              !piece.cutoutUrl ? styles.print : styles.cutout,
              {
                start: `${start}%`,
                top: `${top}%`,
                width: `${width}%`,
                transform: [{ rotate: `${turn}deg` }],
              },
            ]}
          >
            {url && headers ? (
              <Image
                source={{ uri: absoluteUrl(url), headers }}
                style={styles.image}
                contentFit={piece.cutoutUrl ? 'contain' : 'cover'}
                transition={200}
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </View>
        );
      })}
      <Text style={styles.caption} numberOfLines={1}>
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 4,
    backgroundColor: colors.surface,
    transform: [{ rotate: '-1deg' }],
    boxShadow: '0 6px 18px rgba(30, 26, 23, 0.08)',
  },
  // Around the pieces, clear of the handwritten caption below.
  heart: {
    top: '2%',
    bottom: '16%',
    start: '6%',
    end: '6%',
  },
  piece: {
    position: 'absolute',
    aspectRatio: 3 / 4,
  },
  // Lying on the paper, a cut-out casts a small soft shadow.
  cutout: cutoutShadow('flat'),
  print: {
    padding: 5,
    backgroundColor: colors.paper,
    boxShadow: '0 2px 6px rgba(30, 26, 23, 0.12)',
  },
  image: {
    flex: 1,
  },
  caption: {
    position: 'absolute',
    start: '8%',
    end: '8%',
    bottom: '4%',
    fontFamily: fonts.hand,
    fontSize: 30,
    lineHeight: 40,
    color: colors.text,
    textAlign: 'left',
    transform: [{ rotate: '-2deg' }],
  },
});
