import type { ItemCategory } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { AccessibilityInfo, I18nManager, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Hanger, HANGER_HEIGHT, HANGER_PIVOT_Y, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

import { PRINT_HEIGHT, PRINT_WIDTH } from './photo-band';

// A rectangle on screen, in window coordinates.
export type Box = { x: number; y: number; width: number; height: number };

// The piece on its rail: as wide as a slot on the closet's rails, its photo as tall as the
// print's picture is for its width, so the photo keeps its size on the way.
const SLOT = 110;
// The photo inside the print: the paper's border (9, 9, 26) and the grey's padding (10) taken off.
const PICTURE_W = PRINT_WIDTH - 18 - 20;
const PICTURE_H = PRINT_HEIGHT - 35 - 20;
const PHOTO_H = Math.round((SLOT * PICTURE_H) / PICTURE_W);
// The photo hangs a little into the hanger, as a piece does on the rails.
const PHOTO_TOP = HANGER_HEIGHT - 6;
const PIECE_H = PHOTO_TOP + PHOTO_H;
// Where the rail runs, as a share of the screen's height.
const RAIL_AT = 0.4;
const RAIL_INSET = 22;
const FLIGHT_MS = 1200;
const LIFT = 14;
const TILT = I18nManager.isRTL ? 3 : -3;
// When the swing starts, the caption comes and the screen closes, from the tap.
const SWING_AT = 1050;
const CAPTION_AT = 1440;
const DONE_AT = 3200;
const DONE_REDUCED = 1600;

// Where the piece hangs in an overlay of this size, and the move that takes it there from the
// photo in the print (`from`, both in window coordinates). Transforms scale around the piece's
// centre, which is the same in both directions, so the move holds in RTL too (a transform is
// never mirrored, and window coordinates are physical).
export function flightFrom(from: Box | null, overlay: Box) {
  const railY = Math.round(overlay.height * RAIL_AT);
  const left = (overlay.width - SLOT) / 2;
  const top = railY - HANGER_PIVOT_Y;
  if (!from) return { railY, top, x: 0, y: 0, scale: 1 };
  const scale = from.width / SLOT;
  // The photo's top-left corner, from the piece's centre, lands on the print's.
  const x = from.x - overlay.x - left - (SLOT / 2) * (1 - scale);
  const y = from.y - overlay.y - top - PIECE_H / 2 - scale * (PHOTO_TOP - PIECE_H / 2);
  return { railY, top, x, y, scale };
}

type Props = {
  photoUri: string;
  // The photo in the print, where the flight starts; null if it couldn't be measured.
  from: Box | null;
  category: ItemCategory;
  // "On the Tops rail", handwritten under the piece.
  caption: string;
  onDone: () => void;
};

// "Hang it up" (decided 2026-10-31), the signature move for anything entering the closet: the
// print's frame fades, the photo flies to a rail, its hanger appears, it swings once and settles,
// then a handwritten caption names the rail and the sheet closes. A tap closes it at once. With
// reduced motion the piece is simply there. The cut-out isn't made yet when the piece is saved,
// so the photo itself flies.
export function HangUp({ photoUri, from, category, caption, onDone }: Props) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [overlay, setOverlay] = useState<Box | null>(null);
  const flight = useSharedValue(reduceMotion ? 1 : 0);
  const swing = useSharedValue(0);
  const veil = useSharedValue(reduceMotion ? 0.92 : 0);
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const finished = useRef(false);

  function finish() {
    if (finished.current) return;
    finished.current = true;
    done.current();
  }

  // The sheet closes on its own, counted from the tap; the motion waits for the overlay's place.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(caption);
    const timer = setTimeout(finish, reduceMotion ? DONE_REDUCED : DONE_AT);
    return () => clearTimeout(timer);
    // Once, when the overlay comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = overlay !== null;
  useEffect(() => {
    if (!ready || reduceMotion) return;
    veil.value = withDelay(250, withTiming(0.92, { duration: 700 }));
    flight.value = withTiming(1, { duration: FLIGHT_MS, easing: EASE_OUT });
    const step = { duration: 320 };
    swing.value = withDelay(
      SWING_AT,
      withSequence(
        withTiming(8, step),
        withTiming(-5, step),
        withTiming(3, step),
        withTiming(-1.2, step),
        withTiming(0, step),
      ),
    );
    shown.value = withDelay(CAPTION_AT, withTiming(1, { duration: 600 }));
  }, [ready, reduceMotion, veil, flight, swing, shown]);

  const move = flightFrom(from, overlay ?? { x: 0, y: 0, width: 0, height: 0 });
  const piece = useAnimatedStyle(() => {
    const p = flight.value;
    return {
      transform: [
        { translateX: interpolate(p, [0, 0.22, 1], [move.x, move.x, 0]) },
        { translateY: interpolate(p, [0, 0.22, 1], [move.y, move.y - LIFT, 0]) },
        { scale: interpolate(p, [0, 0.22, 1], [move.scale, move.scale * 1.04, 1]) },
        { rotate: `${interpolate(p, [0, 1], [TILT, 0])}deg` },
      ],
    };
  });
  const hanger = useAnimatedStyle(() => ({
    opacity: interpolate(flight.value, [0, 0.7, 1], [0, 0, 1]),
  }));
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${swing.value}deg` }] }));
  const veiled = useAnimatedStyle(() => ({ opacity: veil.value }));
  const rail = useAnimatedStyle(() => ({ opacity: veil.value / 0.92 }));
  const captioned = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={finish}
      accessibilityViewIsModal
      accessibilityRole="button"
      accessibilityLabel={caption}
    >
      {/* Measured for where the overlay is on screen: a modal sheet doesn't start at the top. */}
      <View
        ref={ref}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        onLayout={() =>
          ref.current?.measureInWindow((x, y, width, height) => setOverlay({ x, y, width, height }))
        }
      />
      <Animated.View style={[styles.veil, veiled]} />
      {overlay && (
        <>
          <Animated.View style={[styles.rail, { top: move.railY }, rail]} />
          <Animated.View style={[styles.piece, { top: move.top }, piece]}>
            <Animated.View style={[styles.swing, turn]}>
              <Animated.View style={[styles.hanger, hanger]}>
                <Hanger kind={HANGERS[category]} />
              </Animated.View>
              <Image source={{ uri: photoUri }} style={styles.photo} contentFit="contain" />
            </Animated.View>
          </Animated.View>
        </>
      )}
      {/* Always there, so screen readers and a tap find it before the overlay is measured. */}
      <Animated.Text
        style={[styles.caption, { top: move.top + PIECE_H + 24 }, captioned]}
        accessibilityLiveRegion="polite"
      >
        {caption}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  veil: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.background,
  },
  rail: {
    position: 'absolute',
    start: RAIL_INSET,
    end: RAIL_INSET,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  // Centred, so start and end give the same place in both directions.
  piece: {
    position: 'absolute',
    start: 0,
    end: 0,
    alignItems: 'center',
  },
  // It turns around the hook, where the rail runs through it.
  swing: {
    width: SLOT,
    height: PIECE_H,
    transformOrigin: ['50%', HANGER_PIVOT_Y, 0],
  },
  hanger: {
    alignSelf: 'center',
    width: HANGER_WIDTH,
    height: HANGER_HEIGHT,
  },
  photo: {
    position: 'absolute',
    top: PHOTO_TOP,
    start: 0,
    width: SLOT,
    height: PHOTO_H,
  },
  caption: {
    position: 'absolute',
    start: 20,
    end: 20,
    fontFamily: fonts.hand,
    fontSize: 22,
    color: colors.text,
    textAlign: 'center',
  },
});
