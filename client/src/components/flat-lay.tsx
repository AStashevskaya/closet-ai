import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { absoluteUrl } from '@/lib/api';
import { colors, fonts } from '@/theme';

type Piece = Pick<Item, 'id' | 'name' | 'category' | 'photoUrl' | 'cutoutUrl'>;

type Props = {
  pieces: Piece[];
  headers: Record<string, string> | undefined;
  // Handwritten name of the look.
  caption: string;
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
export function FlatLay({ pieces, headers, caption }: Props) {
  return (
    <View style={styles.sheet} accessible accessibilityLabel={caption}>
      {layOut(pieces).map(([piece, { start, top, width, turn }]) => {
        const url = piece.cutoutUrl ?? piece.photoUrl;
        return (
          <View
            key={piece.id}
            style={[
              styles.piece,
              !piece.cutoutUrl && styles.print,
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
  piece: {
    position: 'absolute',
    aspectRatio: 3 / 4,
  },
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
