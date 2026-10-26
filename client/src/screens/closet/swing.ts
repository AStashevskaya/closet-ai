import type { ItemCategory } from '@closet-ai/shared';
import { useCallback, useEffect, useRef } from 'react';
import { I18nManager } from 'react-native';
import {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// How far the pieces lean for a change in their rail's speed: degrees per px/ms, and the most
// they lean.
const GAIN = 20;
const MAX_LEAN = 28;
// How long (ms) the measured speed takes to follow a new scroll reading: longer is calmer but
// reacts later.
const SMOOTH_MS = 20;
// Pieces lean from changes in the rail's speed, as a real hanger does: they swing out when it
// starts, turns or stops, and hang down again on a steady or slowly coasting rail. This is how long
// (ms) the pieces take to get used to a new speed; longer keeps them leaning longer. Leaning from
// the speed itself left them hanging tilted until the rail fully stopped (2026-10-26).
const SETTLE_MS = 240;
// No scroll event for this long (ms) and the rail is standing still. Speed is measured between
// scroll events, not frames: at 120 Hz every other frame has no event and read as a stop, which
// made the pieces jerk (2026-10-26).
const STILL_MS = 50;

// A pendulum's stiffness: about 0.95 s a swing for an average piece. Damped lightly, so a piece swings past the middle
// several times before it settles, like a hanger nudged on a rail.
const STIFFNESS = 45;
const DAMPING_RATIO = 0.06;
// Longer pieces swing slower, small ones quicker.
const LENGTH: Partial<Record<ItemCategory, number>> = { dress: 0.7, accessory: 1.25 };

// A piece's swing: its angle in degrees and how fast it turns, in degrees per second.
export type Pendulum = { angle: number; spin: number };
// Every piece of a rail by id, stepped together by the rail each frame.
export type Swing = SharedValue<Record<string, Pendulum>>;
const REST: Pendulum = { angle: 0, spin: 0 };

// The lean a change of `speed` gives a rail's pieces: how much faster the rail now moves than
// the pieces are used to, in px/ms along the reading direction (positive: the pieces move towards
// the start). They trail behind, so they lean the other way. Rotation isn't mirrored in RTL, so
// the sign flips there.
export function leanFor(speed: number, rtl: boolean) {
  'worklet';
  const lean = -speed * GAIN * (rtl ? -1 : 1);
  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, lean));
}

// One step of a damped pendulum pulled towards `lean`, `dt` seconds long. Semi-implicit Euler
// (turn first, then move), which stays stable at these stiffnesses for steps up to 1/30 s.
// A real pendulum instead of a spring restarted every frame: those restarts showed as jerks.
export function stepPendulum(piece: Pendulum, lean: number, stiffness: number, dt: number) {
  'worklet';
  const damping = 2 * DAMPING_RATIO * Math.sqrt(stiffness);
  const spin = piece.spin + (stiffness * (lean - piece.angle) - damping * piece.spin) * dt;
  return { angle: piece.angle + spin * dt, spin };
}

function charSum(text: string) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}

// A little different for every piece, and always the same for one piece, so a rail never moves
// in lockstep and a piece keeps its character when its neighbours change.
function stiffnessFor(category: ItemCategory, id: string) {
  return STIFFNESS * (0.82 + (charSum(id) % 36) / 100) * (LENGTH[category] ?? 1);
}

// The swing of one rail: its scroll handler, and every piece's pendulum, stepped each frame on
// the UI thread from the scroll position, so it never waits for JavaScript.
// The frame loop only runs while the rail moves under a finger or coasts, and until every piece
// has come to rest. With reduced motion it never starts and the pieces hang still.
export function useRailSwing(category: ItemCategory, ids: readonly string[]) {
  const reduced = useReducedMotion();
  const rtl = I18nManager.isRTL;
  const offset = useSharedValue(0);
  const last = useSharedValue(0);
  // Time since the offset last changed, and the speed measured over it.
  const idle = useSharedValue(0);
  const raw = useSharedValue(0);
  const speed = useSharedValue(0);
  // The speed the pieces are used to: it follows `speed` with a lag of about SETTLE_MS.
  const usual = useSharedValue(0);
  // A finger is on the rail, or it is still coasting after one.
  const moving = useSharedValue(false);
  const pieces = useSharedValue<{ id: string; stiffness: number }[]>([]);
  const swing = useSharedValue<Record<string, Pendulum>>({});

  // Keyed by the ids as one string, so a new array with the same pieces changes nothing.
  const key = ids.join(',');
  useEffect(() => {
    pieces.set(
      key ? key.split(',').map((id) => ({ id, stiffness: stiffnessFor(category, id) })) : [],
    );
  }, [key, category, pieces]);

  // The loop switches itself off from the JS thread, a frame or so after it asks; by then a new
  // touch may have started the rail again. Held in a ref: the loop is created before it exists.
  const switchLoop = useRef<(on: boolean) => void>(() => {});
  const stop = useCallback(() => {
    if (!moving.get()) switchLoop.current(false);
  }, [moving]);

  const frames = useFrameCallback((frame) => {
    // The first frame after the loop starts may report a long pause, which would read as a slow
    // rail and swallow the start of a fling; no frame counts for more than 1/30 s.
    const frameMs = frame.timeSincePreviousFrame;
    if (!frameMs) return;
    const ms = Math.min(frameMs, 34);

    const delta = offset.get() - last.get();
    idle.set(idle.get() + ms);
    if (delta !== 0) {
      raw.set(delta / idle.get());
      idle.set(0);
      last.set(offset.get());
    } else if (idle.get() > STILL_MS) {
      raw.set(0);
    }
    // In time, not in frames, so it behaves the same at 60 Hz and 120 Hz.
    const smoothed = speed.get() + (raw.get() - speed.get()) * (1 - Math.exp(-ms / SMOOTH_MS));
    speed.set(Math.abs(smoothed) < 0.001 ? 0 : smoothed);
    const follow = usual.get() + (speed.get() - usual.get()) * (1 - Math.exp(-ms / SETTLE_MS));
    usual.set(Math.abs(follow - speed.get()) < 0.001 ? speed.get() : follow);
    const lean = leanFor(speed.get() - usual.get(), rtl);

    const dt = ms / 1000;
    const before = swing.get();
    const after: Record<string, Pendulum> = {};
    let resting = !moving.get() && speed.get() === 0 && usual.get() === 0;
    for (const { id, stiffness } of pieces.get()) {
      const piece = stepPendulum(before[id] ?? REST, lean, stiffness, dt);
      if (Math.abs(piece.angle) > 0.1 || Math.abs(piece.spin) > 1) resting = false;
      after[id] = piece;
    }
    swing.set(resting ? {} : after);
    if (resting) scheduleOnRN(stop);
  }, false);

  useEffect(() => {
    switchLoop.current = frames.setActive;
  }, [frames]);
  const start = useCallback(() => frames.setActive(true), [frames]);

  const begin = () => {
    'worklet';
    if (reduced) return;
    moving.set(true);
    // The offset may have changed while the loop was off (a deleted piece shortens the rail),
    // and that jump isn't motion.
    last.set(offset.get());
    idle.set(0);
    scheduleOnRN(start);
  };
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offset.set(event.contentOffset.x);
    },
    onBeginDrag: begin,
    onMomentumBegin: begin,
    onEndDrag: () => {
      moving.set(false);
    },
    onMomentumEnd: () => {
      moving.set(false);
    },
  });

  return { onScroll, swing };
}

// One piece's turn, read from its rail's swing.
export function usePieceSwing(swing: Swing, id: string) {
  return useAnimatedStyle(() => ({
    transform: [{ rotate: `${swing.get()[id]?.angle ?? 0}deg` }],
  }));
}
