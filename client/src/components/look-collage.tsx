import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { absoluteUrl } from '@/lib/api';
import { colors, fonts } from '@/theme';

type Props = {
  items: Pick<Item, 'id' | 'name' | 'photoUrl' | 'cutoutUrl'>[];
  headers: Record<string, string> | undefined;
  // Handwritten line under the pieces.
  caption: string;
};

// Where each piece lies on the square sheet, by how many there are: start and top in % of the
// sheet, width in % (pieces are 3:4, so their height is 4/3 of that), and a slight turn.
// The bottom fifth stays free for the caption. Fixed, not random, so a look always looks the same.
type Slot = { start: number; top: number; width: number; turn: number };
const slot = (start: number, top: number, width: number, turn: number): Slot => ({
  start,
  top,
  width,
  turn,
});
const LAYOUTS: Slot[][] = [
  [slot(27, 6, 46, -3)],
  [slot(6, 8, 42, -5), slot(52, 16, 42, 4)],
  [slot(3, 6, 36, -6), slot(33, 24, 36, 3), slot(62, 4, 34, 6)],
  [slot(4, 4, 32, -6), slot(38, 0, 32, 3), slot(66, 8, 30, 6), slot(30, 36, 32, -3)],
  [
    slot(4, 2, 30, -6),
    slot(36, 0, 30, 3),
    slot(66, 4, 30, 6),
    slot(18, 38, 30, -3),
    slot(50, 40, 30, 5),
  ],
];
export const MAX_PIECES = LAYOUTS.length;

// Items laid out like cut-outs on a sheet of paper, with a handwritten caption: the "scrapbook"
// layer of the design, for looks and Want / Can results only. Items without a cut-out yet
// show as a small print with a white border.
export function LookCollage({ items, headers, caption }: Props) {
  const pieces = items.slice(0, MAX_PIECES);
  const layout = LAYOUTS[pieces.length - 1];
  if (!layout) return null;

  return (
    <View style={styles.sheet} accessible accessibilityLabel={caption}>
      <View style={styles.tape} />
      {pieces.map((item, index) => {
        const { start, top, width, turn } = layout[index]!;
        const url = item.cutoutUrl ?? item.photoUrl;
        return (
          <View
            key={item.id}
            style={[
              styles.piece,
              !item.cutoutUrl && styles.print,
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
                contentFit={item.cutoutUrl ? 'contain' : 'cover'}
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
    marginVertical: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
    transform: [{ rotate: '-1deg' }],
    boxShadow: '0 6px 18px rgba(30, 26, 23, 0.08)',
  },
  // A strip of washi tape holding the sheet, half on and half off its top edge.
  tape: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    width: 86,
    height: 22,
    backgroundColor: colors.accentSoft,
    opacity: 0.85,
    transform: [{ rotate: '2deg' }],
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
    bottom: '5%',
    fontFamily: fonts.hand,
    fontSize: 30,
    lineHeight: 40,
    color: colors.text,
    textAlign: 'left',
    transform: [{ rotate: '-2deg' }],
  },
});
