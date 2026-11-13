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
export const FLIGHT_MS = 1200;
const LIFT = 14;
// The width of a handwritten step of the first-photo lesson.
const STEP_WIDTH = 220;
const TILT = I18nManager.isRTL ? 3 : -3;
// In a batch the pieces go one after another (docs/design.md).
export const BATCH_STEP = 140;
// The timings of one flight, from the tap (for the last piece): how long it flies, when in the
// flight it has lifted off the print, when the swing starts, the caption comes, the veil starts to
// cover the screen, and when the screen closes.
type Pace = {
  flight: number;
  lifted: number;
  swingAt: number;
  captionAt: number;
  veilAt: number;
  veilMs: number;
  doneAt: number;
  doneReduced: number;
};
const USUAL: Pace = {
  flight: FLIGHT_MS,
  lifted: 0.22,
  swingAt: 1050,
  captionAt: 1440,
  veilAt: 250,
  veilMs: 700,
  doneAt: 3200,
  doneReduced: 1600,
};
// Her first piece (the first-photo lesson, B): slower, so each handwritten step can be read. The
// photo fades under a slower veil while the piece lifts off it and holds a moment, then flies.
export const LESSON_FLIGHT_MS = 2200;
const LESSON: Pace = {
  flight: LESSON_FLIGHT_MS,
  lifted: 0.4,
  swingAt: 2050,
  captionAt: 2500,
  veilAt: 600,
  veilMs: 1400,
  doneAt: 7500,
  doneReduced: 5500,
};
// When the second step ("hanging it up") comes, as the piece leaves the print.
const LESSON_HANGING_AT = 900;
// The note under the caption follows it.
const LESSON_NOTE_AT = 3100;

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

// The handwritten steps of her first piece: under the print as it lifts off ("taking the
// background away…"), beside the rail as it hangs ("hanging it up"), and a note under the caption.
export type Lesson = { lifting: string; hanging: string; note: string };

type Props = {
  pieces: HangPiece[];
  // "On the Tops rail" or "3 pieces in your closet", handwritten under the pieces.
  caption: string;
  // Her first piece: slower, with the steps by hand (once, owner 2026-11-12).
  lesson?: Lesson;
  onDone: () => void;
};

// "Hang it up" (decided 2026-10-31), the signature move for anything entering the closet: the
// print's frame fades, the photo flies to a rail, its hanger appears, it swings once and settles,
// then a handwritten caption names the rail and the sheet closes. Several pieces go one after
// another. A tap closes it at once. With reduced motion the pieces are simply there. What flies
// is the caller's: the bare cut-out when it has one (add-item waits a moment for it), the photo
// otherwise.
export function HangUp({ pieces, caption, lesson, onDone }: Props) {
  const reduceMotion = useReducedMotion();
  const pace = lesson ? LESSON : USUAL;
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [overlay, setOverlay] = useState<Box | null>(null);
  const veil = useSharedValue(reduceMotion ? 0.92 : 0);
  const shown = useSharedValue(reduceMotion ? 1 : 0);
  // The lesson's steps: lifting, hanging, the note (all there at once with reduced motion).
  const lifting = useSharedValue(reduceMotion ? 1 : 0);
  const hanging = useSharedValue(reduceMotion ? 1 : 0);
  const noted = useSharedValue(reduceMotion ? 1 : 0);
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
    AccessibilityInfo.announceForAccessibility(
      lesson ? [lesson.lifting, lesson.hanging, caption, lesson.note].join(' ') : caption,
    );
    const timer = setTimeout(finish, reduceMotion ? pace.doneReduced : pace.doneAt + lag);
    return () => clearTimeout(timer);
    // Once, when the overlay comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = overlay !== null;
  useEffect(() => {
    if (!ready || reduceMotion) return;
    veil.value = withDelay(pace.veilAt, withTiming(0.92, { duration: pace.veilMs }));
    shown.value = withDelay(pace.captionAt + lag, withTiming(1, { duration: 600 }));
    if (!lesson) return;
    lifting.value = withDelay(100, withTiming(1, { duration: 500 }));
    hanging.value = withDelay(LESSON_HANGING_AT, withTiming(1, { duration: 500 }));
    noted.value = withDelay(LESSON_NOTE_AT, withTiming(1, { duration: 700 }));
  }, [ready, reduceMotion, lag, veil, shown, pace, lesson, lifting, hanging, noted]);

  const rail = flightFrom(null, overlay ?? { x: 0, y: 0, width: 0, height: 0 }, 0, pieces.length);
  const veiled = useAnimatedStyle(() => ({ opacity: veil.value }));
  const railShown = useAnimatedStyle(() => ({ opacity: veil.value / 0.92 }));
  const captioned = useAnimatedStyle(() => ({ opacity: shown.value }));
  const liftingShown = useAnimatedStyle(() => ({ opacity: lifting.value }));
  const hangingShown = useAnimatedStyle(() => ({ opacity: hanging.value }));
  const noteShown = useAnimatedStyle(() => ({ opacity: noted.value }));
  // The first step sits under the photo the piece lifts off, the second beside the rail.
  const first = pieces[0]?.from ?? null;
  const liftingAt =
    overlay && first
      ? {
          top: first.y - overlay.y + first.height + 34,
          centre: first.x - overlay.x + first.width / 2,
        }
      : null;
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
              pace={pace}
            />
          ))}
          {lesson && (
            <>
              {/* Placed on the photo's own spot in window coordinates, so by left, in an LTR
                  frame: React Native would swap left in Hebrew. */}
              <View style={[StyleSheet.absoluteFill, styles.ltr]} pointerEvents="none">
                <Animated.Text
                  style={[
                    styles.step,
                    liftingAt
                      ? { top: liftingAt.top, left: liftingAt.centre - STEP_WIDTH / 2 }
                      : {
                          top: Math.max(0, rail.top - 120),
                          left: (overlay.width - STEP_WIDTH) / 2,
                        },
                    liftingShown,
                  ]}
                >
                  {lesson.lifting}
                </Animated.Text>
              </View>
              <Animated.Text
                style={[
                  styles.hanging,
                  { top: rail.railY + 36, width: (overlay.width - SLOT) / 2 - RAIL_INSET - 6 },
                  hangingShown,
                ]}
              >
                {lesson.hanging}
              </Animated.Text>
            </>
          )}
        </>
      )}
      {/* Always there, so a tap finds it before the overlay is measured. Screen readers hear it
          once, announced on mount; the overlay's label repeats it only if they land on it. */}
      <View style={[styles.words, { top: rail.bottom + 24 }]}>
        <Animated.Text style={[styles.caption, captioned]}>{caption}</Animated.Text>
        {lesson && <Animated.Text style={[styles.note, noteShown]}>{lesson.note}</Animated.Text>}
      </View>
    </Pressable>
  );
}

// One piece on its way to the rail, `delay` after the first.
function Hung({
  piece,
  move,
  delay,
  pace,
}: {
  piece: HangPiece;
  move: ReturnType<typeof flightFrom>;
  delay: number;
  pace: Pace;
}) {
  const reduceMotion = useReducedMotion();
  const flight = useSharedValue(reduceMotion ? 1 : 0);
  const swing = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    flight.value = withDelay(delay, withTiming(1, { duration: pace.flight, easing: EASE_OUT }));
    const step = { duration: 320 };
    swing.value = withDelay(
      delay + pace.swingAt,
      withSequence(
        withTiming(8, step),
        withTiming(-5, step),
        withTiming(3, step),
        withTiming(-1.2, step),
        withTiming(0, step),
      ),
    );
  }, [reduceMotion, delay, pace, flight, swing]);

  // Plain numbers for the worklet, listed as its dependencies: they change once, when measured.
  const { x, y, scale } = move;
  const { x: restX, y: restY, scale: restScale } = move.rest;
  const tilt = piece.tilted ? TILT : 0;
  const { lifted } = pace;
  const placed = useAnimatedStyle(() => {
    const p = flight.value;
    return {
      transform: [
        { translateX: interpolate(p, [0, lifted, 1], [x, x, restX]) },
        { translateY: interpolate(p, [0, lifted, 1], [y, y - LIFT, restY]) },
        { scale: interpolate(p, [0, lifted, 1], [scale, scale * 1.04, restScale]) },
        { rotate: `${interpolate(p, [0, 1], [tilt, 0])}deg` },
      ],
    };
  }, [x, y, scale, restX, restY, restScale, tilt, lifted]);
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
  words: {
    position: 'absolute',
    start: 20,
    end: 20,
    gap: 10,
  },
  caption: {
    fontFamily: fonts.hand,
    fontSize: 22,
    color: colors.text,
    textAlign: 'center',
  },
  note: {
    fontFamily: fonts.hand,
    fontSize: 19,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  ltr: {
    direction: 'ltr',
  },
  step: {
    position: 'absolute',
    width: STEP_WIDTH,
    fontFamily: fonts.hand,
    fontSize: 19,
    color: colors.text,
    textAlign: 'center',
  },
  // Beside the piece hanging in the middle, toward the end.
  hanging: {
    position: 'absolute',
    end: RAIL_INSET,
    fontFamily: fonts.hand,
    fontSize: 19,
    color: colors.text,
    textAlign: 'center',
  },
});
