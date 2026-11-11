import type { Item } from '@closet-ai/shared';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useState } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import { cutoutShadow } from '@/components/cutout-shadow';
import { Dimmable } from '@/components/dimmable';
import { HandDrawn } from '@/components/hand-drawn';
import { absoluteUrl } from '@/lib/api';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

export type MobilePiece = Pick<Item, 'id' | 'name' | 'category' | 'photoUrl' | 'cutoutUrl'> & {
  // Not hers (the piece from a photo, a partner's): on a dashed string.
  loose?: boolean;
  // A cut-out shipped with the app (Style it's example), in place of one from the server.
  image?: ImageSource | number;
  // She cut its string: it didn't work in this look (decided 2026-11-11, prototype
  // `~/Desktop/closet/wrinkle-lab/design-strike`, A). It hangs lower and faded on a dashed stub.
  struck?: boolean;
  // Cuts the string, or ties it back; left out for a piece that can't be cut (the one styled).
  onStrike?: () => void;
  // What a screen reader offers for it: "Cut Loafers out of this look" or "Tie Loafers back".
  strikeLabel?: string;
};

type Props = {
  pieces: MobilePiece[];
  headers: Record<string, string> | undefined;
  // Handwritten name of the look.
  caption: string;
  // A look she loves gets a little heart on its wire.
  loved?: boolean;
  // Any number, the same for the same look, so its heart keeps its shape.
  seed?: number;
  // A look she said no to: the wire and pieces faded; the name only a small step in colour, to stay readable.
  dimmed?: boolean;
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
// How far a cut piece drops below where it hung.
const STRUCK_DROP = 22;
const SAG = 10;
const MAX_PIECE = 116;
// Five or six pieces would each get too small a share of the wire to read: past this size they
// overlap their neighbours a little instead.
const MIN_PIECE = 64;

export type Hung = { piece: MobilePiece; x: number; drop: number; width: number };

// Where each piece hangs on a wire this wide: in order across, evenly spaced, each at its drop.
// The drops are counted from the highest piece in the look, so a look without a top (a lone pair of
// shoes) doesn't hang far below an empty wire.
export function hang(pieces: MobilePiece[], width: number): Hung[] {
  const sorted = [...pieces].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const slot = width / Math.max(1, sorted.length);
  const size = Math.min(MAX_PIECE, Math.max(MIN_PIECE, slot * 0.92), width);
  const highest = Math.min(...sorted.map((p) => DROP[p.category]));
  return sorted.map((piece, index) => ({
    piece,
    // Kept inside the wire when the pieces are wider than their share of it.
    x: Math.min(Math.max(slot * (index + 0.5), size / 2), width - size / 2),
    drop: DROP[piece.category] - highest + 8,
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
export function OutfitMobile({
  pieces,
  headers,
  caption,
  loved = false,
  seed = 1,
  dimmed = false,
}: Props) {
  const [width, setWidth] = useState(0);
  const hung = width > 0 ? hang(pieces, width) : [];
  const height = Math.max(...hung.map((h) => h.drop + (h.width * 4) / 3), 120) + WIRE_Y + SAG + 8;
  return (
    <View
      style={styles.mobile}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      // Cutting a piece is an action on the look for a screen reader: the pieces aren't elements.
      accessibilityActions={pieces.flatMap((p) =>
        p.onStrike && p.strikeLabel ? [{ name: `strike:${p.id}`, label: p.strikeLabel }] : [],
      )}
      onAccessibilityAction={(event) => {
        const id = event.nativeEvent.actionName.replace(/^strike:/, '');
        pieces.find((p) => p.id === id)?.onStrike?.();
      }}
      accessible
      // The pieces are pictures only: the look's name, then what's in it.
      accessibilityLabel={[caption, ...pieces.map((p) => p.name)].filter(Boolean).join(', ')}
    >
      {width > 0 && (
        <Dimmable dimmed={dimmed} overlapping style={{ height }} testID="look-pictures">
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
              // Cut: a short end left on the wire, then a dashed stub down to where it hangs now.
              if (piece.struck) {
                const cut = top + Math.max(10, drop * 0.35);
                return (
                  <G key={piece.id}>
                    <Line x1={x} y1={top} x2={x} y2={cut} stroke={colors.text} strokeWidth={1} />
                    <Line
                      x1={x}
                      y1={cut + 8}
                      x2={x}
                      y2={top + drop + 6 + STRUCK_DROP}
                      stroke={colors.textMuted}
                      strokeWidth={1}
                      strokeDasharray={[3, 4]}
                    />
                  </G>
                );
              }
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
            {hung
              .filter(({ piece }) => !piece.struck)
              .map(({ piece, x }) => (
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
        </Dimmable>
      )}
      <Text style={[styles.caption, dimmed && styles.captionDimmed]} numberOfLines={2}>
        {caption}
      </Text>
    </View>
  );
}

// One piece at the end of its string. It settles into place once, swinging a little from the
// top (the string), one after another; still with reduced motion. A firm spring, so it's over in
// well under a second: each piece's shadow is redrawn on every frame of it on Android.
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
    swing.value = withDelay(120 * index, withSpring(0, { damping: 11, stiffness: 60 }));
  }, [index, reduceMotion, swing]);
  // Cut: it slides down a little and fades; tied back, it goes up again.
  const cut = useSharedValue(piece.struck ? 1 : 0);
  useEffect(() => {
    const to = piece.struck ? 1 : 0;
    cut.value = reduceMotion ? to : withTiming(to, { duration: durations.settle / 2 });
  }, [piece.struck, reduceMotion, cut]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - cut.value * 0.62,
    transform: [{ translateY: cut.value * STRUCK_DROP }, { rotate: `${swing.value}deg` }],
  }));
  const url = piece.cutoutUrl ?? piece.photoUrl;
  const cutout = piece.image !== undefined || Boolean(piece.cutoutUrl);
  const source = piece.image ?? (url && headers ? { uri: absoluteUrl(url), headers } : null);
  return (
    <Animated.View
      style={[
        styles.piece,
        cutout ? styles.cutout : styles.print,
        { start: x - width / 2, top, width, height: (width * 4) / 3 },
        style,
      ]}
    >
      <Pressable
        style={styles.image}
        onPress={piece.onStrike}
        disabled={!piece.onStrike}
        // The look as a whole is what a screen reader reaches; it carries the cut as an action.
        accessible={false}
        testID={piece.onStrike ? `strike-${piece.id}` : undefined}
      >
        {source ? (
          <Image
            source={source}
            style={styles.image}
            contentFit={cutout ? 'contain' : 'cover'}
            transition={200}
            accessibilityIgnoresInvertColors
            testID="hung-piece"
          />
        ) : null}
      </Pressable>
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
  captionDimmed: {
    color: colors.textSecondary,
  },
});
