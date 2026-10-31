import type { CatalogItem, Item, LookItem, MatchKind } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';

import { BarePiece } from '@/components/bare-piece';
import { Hanger, HANGER_HEIGHT, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { priceLabel } from '@/lib/price';
import { LookCrop } from '@/screens/add-look/look-crop';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

export type Found = {
  item: LookItem;
  match: { how: MatchKind; item: Item | null; shop: CatalogItem[] };
};

type Props = {
  // The screenshot as picked, and its width over its height.
  uri: string;
  aspect: number;
  found: Found[];
  headers: Record<string, string> | undefined;
};

// The stage is never taller than this: a story screenshot would fill two screens.
const MAX_HEIGHT = 520;
// Room around the pieces found, so the look isn't cut at its edges.
const PAD = 0.05;
// The curtain stops short of the edges, so its bead can always be caught again.
const EDGE = 0.06;
const BEAD = 44;
// Read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
const RTL = I18nManager.isRTL;

// Where the stage shows the screenshot: around every piece found, fitted to the width (or to
// MAX_HEIGHT and centred). Units: the photo is `aspect` wide and 1 high.
export function frameOf(found: Found[], aspect: number, width: number) {
  const boxes = found.map((f) => f.item.box);
  const x1 = Math.max(0, Math.min(...boxes.map((b) => b.xMin)) - PAD) * aspect;
  const x2 = Math.min(1, Math.max(...boxes.map((b) => b.xMax)) + PAD) * aspect;
  const y1 = Math.max(0, Math.min(...boxes.map((b) => b.yMin)) - PAD);
  const y2 = Math.min(1, Math.max(...boxes.map((b) => b.yMax)) + PAD);
  const scale = Math.min(width / (x2 - x1), MAX_HEIGHT / (y2 - y1));
  return {
    scale,
    height: (y2 - y1) * scale,
    // Where the photo's top left corner goes on the stage.
    left: width / 2 - ((x1 + x2) / 2) * scale,
    top: -y1 * scale,
  };
}

// "Hers / yours" (decided 2026-10-31, prototype `~/Desktop/closet/wrinkle-lab/design-recreate`,
// direction B with C's empty hangers): the screenshot, and over it a curtain dragged by its cherry
// bead; behind the curtain the same look built from her closet, each piece where the look's was.
// What she doesn't have hangs as an empty dashed hanger with the piece's ghost and, when a partner
// has one like it, its price. On opening the curtain draws itself across to the middle.
// Both sides share one frame, placed with left / top: photo pixels aren't mirrored in RTL. In
// Hebrew hers is on the right and the curtain opens the other way.
// Decorative for screen readers: the rows under it say the same.
export function Curtain({ uri, aspect, found, headers }: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  // The curtain's place across the stage, in points from its left edge.
  const cut = useSharedValue(0);
  const start = useSharedValue(0);
  const frame = width > 0 && found.length > 0 ? frameOf(found, aspect, width) : null;

  // Placed as the stage is measured, before its first frame shows (an effect would show the curtain
  // at 0 for a frame). The opening slide plays once; a later layout (the phone turned) keeps where
  // she left the curtain, at the same share of the width.
  const played = useRef(false);
  function measure(next: number) {
    if (next === width) return;
    if (played.current) {
      if (width > 0) cut.set((cut.get() * next) / width);
    } else {
      played.current = true;
      if (reduceMotion) {
        cut.set(next / 2);
      } else {
        // From all hers to the middle, after the stage has risen in.
        cut.set(RTL ? next * EDGE : next * (1 - EDGE));
        const middle = withTiming(next / 2, { duration: durations.settle, easing: EASE_OUT });
        cut.set(withDelay(500, middle));
      }
    }
    setWidth(next);
  }

  const grab = () => void Haptics.selectionAsync();
  // Sideways only, so the screen still scrolls under a vertical swipe.
  const drag = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onStart(() => {
      start.set(cut.get());
      scheduleOnRN(grab);
    })
    .onUpdate((e) => {
      cut.set(clamp(start.get() + e.translationX, width * EDGE, width * (1 - EDGE)));
    });

  // Hers is the screenshot underneath; yours is a window over it, from the curtain to the far edge
  // (the near one in Hebrew), its contents held still while the window moves.
  const window = useAnimatedStyle(() => ({
    transform: [{ translateX: RTL ? cut.get() - width : cut.get() }],
  }));
  const still = useAnimatedStyle(() => ({
    transform: [{ translateX: RTL ? width - cut.get() : -cut.get() }],
  }));
  const knife = useAnimatedStyle(() => ({ transform: [{ translateX: cut.get() }] }));

  const place = (box: LookItem['box']) =>
    frame && {
      left: frame.left + box.xMin * aspect * frame.scale,
      top: frame.top + box.yMin * frame.scale,
      width: (box.xMax - box.xMin) * aspect * frame.scale,
      height: (box.yMax - box.yMin) * frame.scale,
    };

  return (
    // Not flex: 1 as by default: in a scroll view that would squeeze the stage to nothing.
    <GestureHandlerRootView style={styles.root}>
      <View
        style={[styles.stage, frame && { height: frame.height }]}
        onLayout={(event) => measure(Math.round(event.nativeEvent.layout.width))}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        testID="curtain"
      >
        {frame && (
          <GestureDetector gesture={drag}>
            <View style={StyleSheet.absoluteFill}>
              <Image
                source={{ uri }}
                style={{
                  position: 'absolute',
                  left: frame.left,
                  top: frame.top,
                  width: aspect * frame.scale,
                  height: frame.scale,
                }}
                accessibilityIgnoresInvertColors
              />
              <Animated.View style={[styles.window, { width }, window]}>
                <Animated.View style={[styles.yours, { width }, still]}>
                  {found.map(({ item, match }, index) => {
                    const at = place(item.box);
                    const offer = match.shop[0];
                    return match.item ? (
                      <BarePiece
                        key={index}
                        item={match.item}
                        headers={headers}
                        style={[styles.slot, at]}
                      />
                    ) : (
                      <View
                        key={index}
                        style={[styles.slot, styles.empty, at]}
                        testID="empty-hanger"
                      >
                        <View style={styles.ghost}>
                          <LookCrop uri={uri} aspect={aspect} box={item.box} style={styles.fill} />
                        </View>
                        <View style={styles.hanger}>
                          <Hanger kind={HANGERS[item.category]} dashed />
                        </View>
                        {offer && (
                          <Text style={styles.price}>
                            {priceLabel(offer.price, offer.currency)}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </Animated.View>
              </Animated.View>
              <Text style={[styles.label, RTL ? styles.right : styles.left]}>{t('want.hers')}</Text>
              <Text style={[styles.label, RTL ? styles.left : styles.right]}>
                {t('want.yours')}
              </Text>
              <Animated.View style={[styles.knife, knife]}>
                <View style={styles.line} />
                <View style={styles.bead}>
                  <Svg width={22} height={12} viewBox="0 0 22 12" aria-hidden>
                    <Path
                      d="M6 1L1 6l5 5M16 1l5 5-5 5M1 6h20"
                      fill="none"
                      stroke={colors.onBead}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>
              </Animated.View>
            </View>
          </GestureDetector>
        )}
      </View>
    </GestureHandlerRootView>
  );
}

// How much of the look she has: a bead on the thread per piece, full for hers, dashed for one
// she doesn't have, and the count beside them.
export function Beads({ found, summary }: { found: Found[]; summary: string }) {
  return (
    <View style={styles.beads}>
      <View style={styles.thread} />
      {found.map(({ match }, index) => (
        <View
          key={index}
          style={[styles.dot, match.item ? styles.dotMine : styles.dotNone]}
          testID={match.item ? 'bead-mine' : 'bead-none'}
        />
      ))}
      <Text style={styles.summary}>{summary}</Text>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  root: {
    flex: 0,
  },
  stage: {
    marginHorizontal: -22,
    height: 360,
    overflow: 'hidden',
    backgroundColor: colors.hero,
  },
  window: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  yours: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.paper,
  },
  slot: {
    position: 'absolute',
  },
  empty: {
    borderWidth: 1.2,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  // Under the hanger, which hangs inside the frame: above it, a piece at the top of the look would
  // lose its hanger to the stage's edge.
  ghost: {
    ...StyleSheet.absoluteFill,
    margin: 6,
    marginTop: HANGER_HEIGHT,
    opacity: 0.22,
  },
  fill: {
    flex: 1,
  },
  hanger: {
    position: 'absolute',
    top: 2,
    left: '50%',
    marginLeft: -HANGER_WIDTH / 2,
  },
  price: {
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.bead,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onBead,
  },
  label: {
    position: 'absolute',
    top: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.paper,
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
  },
  left: {
    left: 12,
  },
  right: {
    right: 12,
  },
  knife: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.2,
    backgroundColor: colors.text,
  },
  bead: {
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.bead,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beads: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  thread: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: '50%',
    height: 1.2,
    backgroundColor: colors.text,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  dotMine: {
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.bead,
  },
  dotNone: {
    borderWidth: 1.2,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    backgroundColor: colors.background,
  },
  summary: {
    marginStart: 'auto',
    paddingStart: 10,
    backgroundColor: colors.background,
    fontFamily: fonts.displayLight,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'left',
  },
});
