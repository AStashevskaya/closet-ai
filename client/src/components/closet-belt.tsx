import { useEffect } from 'react';
import { I18nManager, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { Hanger, HANGER_PIVOT_Y, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { RailLine } from '@/components/rail-line';
import { useClosetPieces } from '@/lib/closet-pieces';
import { durations } from '@/motion';

// At most this many of her pieces, each hung twice so the loop has no seam. Fewer than the least of
// them don't fill a rail, so the gap would show going round: they hang still instead.
const MOST = 8;
const LEAST_TO_ROLL = 5;
const SLOT = 84;
// Points a second: slow enough to look at.
const SPEED = 30;
const HANG_WIDTH = 50;
// How far the hook's point on the rail is from the top of a hanger this wide.
const HANG_PIVOT = (HANGER_PIVOT_Y * HANG_WIDTH) / HANGER_WIDTH;
const RAIL_Y = 8;
const IMAGE_HEIGHT = 96;
const HEIGHT = 140;
// Read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
const DIRECTION = I18nManager.isRTL ? 1 : -1;

// Her closet going past while looks are put together from it (owner, 2026-11-09, docs/design.md,
// "Waiting"): what's happening, shown with her own pieces. The tag on the rail stays the only sign
// of waiting. One transform on the UI thread moves the whole strip, and each piece is flattened into
// a texture, so it asks little of a mid-range Android. Only decoration, so screen readers skip it:
// the caller keeps the progressbar and the announcements. Its load failing leaves just the rail.
export function ClosetBelt({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const { pieces, headers } = useClosetPieces(MOST);
  const rolling = pieces.length >= LEAST_TO_ROLL && !reduced;
  const hung = rolling ? [...pieces, ...pieces] : pieces;
  // One round of the belt: where the doubled strip looks just as it did at the start.
  const round = pieces.length * SLOT;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (!rolling) return;
    progress.set(0);
    progress.set(
      withRepeat(
        withTiming(1, { duration: (round / SPEED) * 1000, easing: Easing.linear }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(progress);
  }, [rolling, round, progress]);
  // Against the reading direction, as new pieces come in from its end; mirrored in Hebrew.
  const moving = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * round * DIRECTION }],
  }));

  return (
    <Animated.View
      testID="closet-belt"
      style={[styles.belt, style]}
      entering={FadeIn.duration(durations.leave)}
      exiting={FadeOut.duration(durations.state)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.window}>
        <Animated.View testID="closet-belt-strip" style={[styles.strip, moving]}>
          {hung.map((piece, index) => (
            <View
              key={`${piece.id}-${index}`}
              testID="belt-piece"
              style={styles.slot}
              renderToHardwareTextureAndroid
              shouldRasterizeIOS
            >
              <Hanger kind={HANGERS[piece.category]} width={HANG_WIDTH} />
              <BarePiece item={piece} headers={headers} style={styles.image} />
            </View>
          ))}
        </Animated.View>
      </View>
      <RailLine waiting style={styles.rail} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  belt: {
    height: HEIGHT,
  },
  // Crops the strip at the belt's edges; the rail and the tag are outside it, so nothing cuts them.
  window: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  strip: {
    position: 'absolute',
    top: RAIL_Y - HANG_PIVOT,
    start: 0,
    flexDirection: 'row',
  },
  rail: {
    position: 'absolute',
    top: RAIL_Y,
    start: 0,
    end: 0,
  },
  slot: {
    width: SLOT,
    alignItems: 'center',
  },
  image: {
    width: 74,
    height: IMAGE_HEIGHT,
    marginTop: -4,
  },
});
