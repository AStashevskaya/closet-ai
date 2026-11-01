import type { ItemCategory } from '@closet-ai/shared';
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Dimensions,
  I18nManager,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
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

import { PICTURE } from './photo-band';

// A rectangle on screen, in window coordinates.
export type Box = { x: number; y: number; width: number; height: number };

// The piece on its rail: as wide as a slot on the closet's rails, its photo as tall as the
// print's picture is for its width, so the photo keeps its size on the way.
const SLOT = 110;
const PHOTO_H = Math.round((SLOT * PICTURE.height) / PICTURE.width);
// The photo's frame, width over height: a caller fits what flies (a piece of a selfie) into it.
export const PHOTO_ASPECT = SLOT / PHOTO_H;
// The photo's frame on its way: a cut-out placed by its box in the print is placed the same way here.
export const PHOTO_FRAME = { width: SLOT, height: PHOTO_H };
// The photo hangs a little into the hanger, as a piece does on the rails.
const PHOTO_TOP = HANGER_HEIGHT - 6;
const PIECE_H = PHOTO_TOP + PHOTO_H;
// Where the rail runs, as a share of the screen's height.
const RAIL_AT = 0.4;
const RAIL_INSET = 22;
// Room between pieces hung together; past a few they get smaller to fit on the rail.
const GAP = 10;
const FLIGHT_MS = 1200;
const LIFT = 14;
const TILT = I18nManager.isRTL ? 3 : -3;
// In a batch the pieces go one after another (docs/design.md).
export const BATCH_STEP = 140;
// When the swing starts, the caption comes and the screen closes, from the tap (for the last piece).
const SWING_AT = 1050;
const CAPTION_AT = 1440;
const DONE_AT = 3200;
const DONE_REDUCED = 1600;

// Where piece `index` of `count` hangs in an overlay of this size, and the move that takes it
// there from its photo on the screen (`from`, both in window coordinates). Every piece is laid out
// in the middle and placed by transforms, which scale around the piece's centre, so the maths
// holds in both directions (a transform is never mirrored, and window coordinates are physical).
// In RTL the first piece hangs on the right, where reading starts.
export function flightFrom(from: Box | null, overlay: Box, index = 0, count = 1) {
  const railY = Math.round(overlay.height * RAIL_AT);
  const top = railY - HANGER_PIVOT_Y;
  const left = (overlay.width - SLOT) / 2;
  const width = Math.min(SLOT, (overlay.width - RAIL_INSET * 2 - GAP * (count - 1)) / count);
  const k = width / SLOT;
  const order = I18nManager.isRTL ? count - 1 - index : index;
  const centre = overlay.width / 2 + (order - (count - 1) / 2) * (width + GAP);
  // At rest: the hook on the rail at its slot (it stays there whatever the scale), the piece at
  // its slot's size.
  const rest = {
    x: centre - overlay.width / 2,
    y: k < 1 ? (HANGER_PIVOT_Y - PIECE_H / 2) * (1 - k) : 0,
    scale: k,
  };
  // Where the hung pieces end, for the caption under them.
  const bottom = railY + k * (PIECE_H - HANGER_PIVOT_Y);
  if (!from) return { railY, top, bottom, rest, ...rest };
  const scale = from.width / SLOT;
  // The photo's top-left corner, from the piece's centre, lands on the one on screen.
  const x = from.x - overlay.x - left - (SLOT / 2) * (1 - scale);
  const y = from.y - overlay.y - top - PIECE_H / 2 - scale * (PHOTO_TOP - PIECE_H / 2);
  return { railY, top, bottom, rest, x, y, scale };
}

// How long "Hang it up" waits for a view to say where it is before flying from the rail.
const MEASURE_MS = 150;

// Where a view is on screen, or null if it doesn't say in time or is scrolled out of sight (the
// piece then hangs on the rail without flying in from far off-screen).
export function measureBox(view: ComponentRef<typeof View> | null): Promise<Box | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    const timer = setTimeout(() => resolve(null), MEASURE_MS);
    view.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      const visible = width > 0 && y + height > 0 && y < Dimensions.get('window').height;
      resolve(visible ? { x, y, width, height } : null);
    });
  });
}

export type HangPiece = {
  key: string;
  // The photo that flies, drawn into the slot's frame (PHOTO_ASPECT wide over high).
  photo: ReactNode;
  // Where it is on screen, where the flight starts; null if it couldn't be measured.
  from: Box | null;
  category: ItemCategory;
  // The hero print is tilted (docs/design.md); it straightens on the way.
  tilted?: boolean;
};

type Props = {
  pieces: HangPiece[];
  // "On the Tops rail" or "3 pieces in your closet", handwritten under the pieces.
  caption: string;
  onDone: () => void;
};

// "Hang it up" (decided 2026-10-31), the signature move for anything entering the closet: the
// print's frame fades, the photo flies to a rail, its hanger appears, it swings once and settles,
// then a handwritten caption names the rail and the sheet closes. Several pieces go one after
// another. A tap closes it at once. With reduced motion the pieces are simply there. What flies
// is the caller's: the bare cut-out when it has one (add-item waits a moment for it), the photo
// otherwise.
export function HangUp({ pieces, caption, onDone }: Props) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [overlay, setOverlay] = useState<Box | null>(null);
  const veil = useSharedValue(reduceMotion ? 0.92 : 0);
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const finished = useRef(false);
  // The last piece leaves this long after the first.
  const lag = (pieces.length - 1) * BATCH_STEP;

  function finish() {
    if (finished.current) return;
    finished.current = true;
    done.current();
  }

  // The sheet closes on its own, counted from the tap; the motion waits for the overlay's place.
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(caption);
    const timer = setTimeout(finish, reduceMotion ? DONE_REDUCED : DONE_AT + lag);
    return () => clearTimeout(timer);
    // Once, when the overlay comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = overlay !== null;
  useEffect(() => {
    if (!ready || reduceMotion) return;
    veil.value = withDelay(250, withTiming(0.92, { duration: 700 }));
    shown.value = withDelay(CAPTION_AT + lag, withTiming(1, { duration: 600 }));
  }, [ready, reduceMotion, lag, veil, shown]);

  const rail = flightFrom(null, overlay ?? { x: 0, y: 0, width: 0, height: 0 }, 0, pieces.length);
  const veiled = useAnimatedStyle(() => ({ opacity: veil.value }));
  const railShown = useAnimatedStyle(() => ({ opacity: veil.value / 0.92 }));
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
          <Animated.View style={[styles.rail, { top: rail.railY }, railShown]} />
          {pieces.map((piece, index) => (
            <Hung
              key={piece.key}
              piece={piece}
              move={flightFrom(piece.from, overlay, index, pieces.length)}
              delay={index * BATCH_STEP}
            />
          ))}
        </>
      )}
      {/* Always there, so a tap finds it before the overlay is measured. Screen readers hear it
          once, announced on mount; the overlay's label repeats it only if they land on it. */}
      <Animated.Text style={[styles.caption, { top: rail.bottom + 24 }, captioned]}>
        {caption}
      </Animated.Text>
    </Pressable>
  );
}

// One piece on its way to the rail, `delay` after the first.
function Hung({
  piece,
  move,
  delay,
}: {
  piece: HangPiece;
  move: ReturnType<typeof flightFrom>;
  delay: number;
}) {
  const reduceMotion = useReducedMotion();
  const flight = useSharedValue(reduceMotion ? 1 : 0);
  const swing = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    flight.value = withDelay(delay, withTiming(1, { duration: FLIGHT_MS, easing: EASE_OUT }));
    const step = { duration: 320 };
    swing.value = withDelay(
      delay + SWING_AT,
      withSequence(
        withTiming(8, step),
        withTiming(-5, step),
        withTiming(3, step),
        withTiming(-1.2, step),
        withTiming(0, step),
      ),
    );
  }, [reduceMotion, delay, flight, swing]);

  // Plain numbers for the worklet, listed as its dependencies: they change once, when measured.
  const { x, y, scale } = move;
  const { x: restX, y: restY, scale: restScale } = move.rest;
  const tilt = piece.tilted ? TILT : 0;
  const placed = useAnimatedStyle(() => {
    const p = flight.value;
    return {
      transform: [
        { translateX: interpolate(p, [0, 0.22, 1], [x, x, restX]) },
        { translateY: interpolate(p, [0, 0.22, 1], [y, y - LIFT, restY]) },
        { scale: interpolate(p, [0, 0.22, 1], [scale, scale * 1.04, restScale]) },
        { rotate: `${interpolate(p, [0, 1], [tilt, 0])}deg` },
      ],
    };
  }, [x, y, scale, restX, restY, restScale, tilt]);
  const hanger = useAnimatedStyle(() => ({
    opacity: interpolate(flight.value, [0, 0.7, 1], [0, 0, 1]),
  }));
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${swing.value}deg` }] }));

  return (
    <Animated.View style={[styles.piece, { top: move.top }, placed]} testID="hung-piece">
      <Animated.View style={[styles.swing, turn]}>
        <Animated.View style={[styles.hanger, hanger]}>
          <Hanger kind={HANGERS[piece.category]} />
        </Animated.View>
        <View style={styles.photo}>{piece.photo}</View>
      </Animated.View>
    </Animated.View>
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
