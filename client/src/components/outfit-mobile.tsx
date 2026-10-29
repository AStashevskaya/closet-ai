import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { cutoutShadow } from '@/components/cutout-shadow';
import { HandDrawn } from '@/components/hand-drawn';
import { absoluteUrl } from '@/lib/api';
import { colors, fonts } from '@/theme';

type Piece = Pick<Item, 'id' | 'category' | 'photoUrl' | 'cutoutUrl'> & {
  // Not hers (the piece from a photo, a partner's): on a dashed string.
  loose?: boolean;
};

type Props = {
  pieces: Piece[];
  headers: Record<string, string> | undefined;
  // Handwritten name of the look.
  caption: string;
  // A look she loves gets a little heart on its wire.
  loved?: boolean;
  // Any number, the same for the same look, so its heart keeps its shape.
  seed?: number;
};

// Across the look as it's worn, start to end: layers and tops first, shoes and bags last.
const ORDER: Item['category'][] = ['outerwear', 'top', 'dress', 'bottom', 'shoes', 'accessory'];
// How far each kind hangs below the wire, so the mobile reads top to toe: shoulders on short
// strings, the bottom lower, shoes lowest (owner's pick, 2026-10-29).
const DROP: Record<Item['category'], number> = {
  outerwear: 8,
  top: 22,
  dress: 14,
  bottom: 64,
  shoes: 112,
  accessory: 46,
};
const WIRE_Y = 14;
const SAG = 10;
const MAX_PIECE = 116;

export type Hung = { piece: Piece; x: number; drop: number; width: number };

// Where each piece hangs on a wire this wide: in order across, evenly spaced, each at its drop.
export function hang(pieces: Piece[], width: number): Hung[] {
  const sorted = [...pieces].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const slot = width / Math.max(1, sorted.length);
  const size = Math.min(MAX_PIECE, slot * 0.92);
  return sorted.map((piece, index) => ({
    piece,
    x: slot * (index + 0.5),
    drop: DROP[piece.category],
    width: size,
  }));
}

// Where the wire is at x: a soft sag between its two ends.
const wireY = (x: number, width: number) => {
  const t = (2 * x) / width - 1;
  return WIRE_Y + SAG * (1 - t * t);
};

// An outfit hanging off its own little thread, like a mobile (decided 2026-10-29, prototype
// `~/Desktop/closet/wrinkle-lab/design-photo-outfits`, card "Подвеска"): each piece on a string at
// its own length, her pieces on solid ones, what isn't hers on dashed ones, the name of the look
// by hand below. The wire is drawn left to right and mirrored in RTL, like the thread.
export function OutfitMobile({ pieces, headers, caption, loved = false, seed = 1 }: Props) {
  const [width, setWidth] = useState(0);
  const hung = width > 0 ? hang(pieces, width) : [];
  const height = Math.max(...hung.map((h) => h.drop + (h.width * 4) / 3), 120) + WIRE_Y + SAG + 8;
  return (
    <View
      style={styles.mobile}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      accessible
      accessibilityLabel={caption}
    >
      {width > 0 && (
        <View style={{ height }}>
          <Svg
            width={width}
            height={height}
            style={[StyleSheet.absoluteFill, I18nManager.isRTL && styles.mirrored]}
            aria-hidden
          >
            <Path
              d={`M2 ${WIRE_Y} Q${width / 2} ${WIRE_Y + 2 * SAG} ${width - 2} ${WIRE_Y}`}
              fill="none"
              stroke={colors.text}
              strokeWidth={1.2}
              strokeLinecap="round"
            />
            {hung.map(({ piece, x, drop }) => {
              const top = wireY(x, width);
              return (
                <Line
                  key={piece.id}
                  x1={x}
                  y1={top}
                  x2={x}
                  y2={top + drop + 6}
                  stroke={piece.loose ? colors.textMuted : colors.text}
                  strokeWidth={1}
                  strokeDasharray={piece.loose ? [3, 4] : undefined}
                />
              );
            })}
            {hung.map(({ piece, x }) => (
              <Circle
                key={`knot-${piece.id}`}
                cx={x}
                cy={wireY(x, width)}
                r={3}
                fill={piece.loose ? colors.background : colors.bead}
                stroke={piece.loose ? colors.textMuted : colors.text}
                strokeWidth={1}
              />
            ))}
          </Svg>
          {hung.map((h, index) => (
            <Hanging
              key={h.piece.id}
              hung={h}
              top={wireY(h.x, width) + h.drop}
              index={index}
              headers={headers}
            />
          ))}
          {loved && (
            <View style={styles.heart}>
              <HandDrawn shape="heart" drawn seed={seed} fill />
            </View>
          )}
        </View>
      )}
      <Text style={styles.caption} numberOfLines={2}>
        {caption}
      </Text>
    </View>
  );
}

// One piece at the end of its string. It settles into place once, swinging a little from the
// top (the string), one after another; still with reduced motion.
function Hanging({
  hung: { piece, x, width },
  top,
  index,
  headers,
}: {
  hung: Hung;
  top: number;
  index: number;
  headers: Record<string, string> | undefined;
}) {
  const reduceMotion = useReducedMotion();
  const swing = useSharedValue(reduceMotion ? 0 : index % 2 ? -5 : 5);
  useEffect(() => {
    if (reduceMotion) return;
    swing.value = withDelay(120 * index, withSpring(0, { damping: 6, stiffness: 40 }));
  }, [index, reduceMotion, swing]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${swing.value}deg` }] }));
  const url = piece.cutoutUrl ?? piece.photoUrl;
  return (
    <Animated.View
      style={[
        styles.piece,
        piece.cutoutUrl ? styles.cutout : styles.print,
        { start: x - width / 2, top, width, height: (width * 4) / 3 },
        style,
      ]}
    >
      {url && headers ? (
        <Image
          source={{ uri: absoluteUrl(url), headers }}
          style={styles.image}
          contentFit={piece.cutoutUrl ? 'contain' : 'cover'}
          transition={200}
          accessibilityIgnoresInvertColors
          testID="hung-piece"
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mobile: {
    width: '100%',
    gap: 6,
  },
  // In RTL the wire and strings are drawn mirrored, so they meet the pieces laid out from the end.
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  piece: {
    position: 'absolute',
    // It swings from where the string holds it.
    transformOrigin: '50% 0%',
  },
  cutout: cutoutShadow('hanging'),
  print: {
    padding: 4,
    backgroundColor: colors.paper,
    boxShadow: '0 2px 6px rgba(30, 26, 23, 0.12)',
  },
  image: {
    flex: 1,
  },
  heart: {
    position: 'absolute',
    top: 0,
    end: 4,
    width: 30,
    height: 28,
  },
  caption: {
    fontFamily: fonts.hand,
    fontSize: 28,
    lineHeight: 36,
    color: colors.text,
    textAlign: 'left',
  },
});
