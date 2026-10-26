import type { ItemCategory } from '@closet-ai/shared';
import { I18nManager } from 'react-native';
import {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

// How far the pieces lean for how fast their rail moves: degrees per px/ms of scroll, and the
// most they lean. Tuned on the prototype (wrinkle-lab/design-rail, "Natural").
const GAIN = 8;
const MAX_LEAN = 15;
// Share of each new speed reading taken per frame, so one jittery scroll event doesn't jolt them.
const SMOOTHING = 0.3;

// The lean a rail moving at `speed` gives its pieces. `speed` is px/ms along the reading
// direction (positive: the pieces move towards the start); they trail behind, so they lean the
// other way. Rotation isn't mirrored in RTL, so the sign flips there.
export function leanFor(speed: number, rtl: boolean) {
  'worklet';
  const lean = -speed * GAIN * (rtl ? -1 : 1);
  return Math.max(-MAX_LEAN, Math.min(MAX_LEAN, lean));
}

// The swing of one rail: its scroll handler, and the lean it sets for its pieces each frame.
// Read on the UI thread from the scroll position, so it never waits for JavaScript.
export function useRailSwing() {
  const reduced = useReducedMotion();
  const rtl = I18nManager.isRTL;
  const offset = useSharedValue(0);
  const last = useSharedValue(0);
  const speed = useSharedValue(0);
  const lean = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    offset.set(event.contentOffset.x);
  });

  // Every frame, but next to nothing once the rail is still: a subtraction and two comparisons.
  useFrameCallback((frame) => {
    const dt = frame.timeSincePreviousFrame;
    if (!dt) return;
    const v = (offset.get() - last.get()) / dt;
    last.set(offset.get());
    const smoothed = speed.get() + (v - speed.get()) * SMOOTHING;
    speed.set(Math.abs(smoothed) < 0.001 ? 0 : smoothed);
    const next = reduced ? 0 : leanFor(speed.get(), rtl);
    // Only real changes reach the pieces; each one restarts their springs.
    if (Math.abs(next - lean.get()) > 0.01 || (next === 0 && lean.get() !== 0)) lean.set(next);
  });

  return { onScroll, lean };
}

// A pendulum's stiffness: about 0.9 s a swing. Damped lightly, so a piece swings past the middle
// a couple of times before it settles, like a hanger nudged on a rail.
const STIFFNESS = 49;
const DAMPING_RATIO = 0.12;
// Longer pieces swing slower, small ones quicker.
const LENGTH: Partial<Record<ItemCategory, number>> = { dress: 0.7, accessory: 1.25 };

// One piece's swing: its angle chases the rail's lean on a spring. A spring that is retargeted
// keeps its speed, so the piece trails while the rail moves and overshoots when it stops.
export function usePieceSwing(lean: SharedValue<number>, category: ItemCategory, seed: number) {
  // A little different for every piece, so a rail never moves in lockstep.
  const stiffness = STIFFNESS * (0.82 + (seed % 36) / 100) * (LENGTH[category] ?? 1);
  const angle = useSharedValue(0);

  useAnimatedReaction(
    () => lean.get(),
    (to) => {
      angle.set(
        withSpring(to, {
          mass: 1,
          stiffness,
          damping: 2 * DAMPING_RATIO * Math.sqrt(stiffness),
        }),
      );
    },
  );

  return useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
}
