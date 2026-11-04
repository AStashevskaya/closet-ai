import { useEffect, useState, type ReactNode } from 'react';
import { I18nManager, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { durations, EASE_OUT } from '@/motion';
import { colors } from '@/theme';

import { SIGN_BOX, SIGN_REACH, WaitingSign } from './waiting-sign';

// A thread drawn down a column with its stops on it: the add-item fields and the auth screens
// (docs/design.md, "The thread" and "Waiting"). Threads that run across (the look's, the closet's
// rail) share the motion and the bead's way along them (`runAcross`).

// Where the thread runs, from the start edge of the column, and where the stops' content starts.
export const THREAD_X = 9;
export const INDENT = 34;
export const DOT = 9;
// The box the sign of waiting runs in (`WaitingSign`); its centre is on the thread.
export const BEAD = SIGN_BOX;
// The ink line's width, and the dots' outline.
export const LINE_WEIGHT = 1.2;
const DRAW_MS = 2000;
const RUN_MS = 2400;
// Read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
const RTL = I18nManager.isRTL;

// The motion every thread has: it draws itself in once it's measured (at once with Reduce
// Motion), and while something is waited for a bead runs along it, over and over (with Reduce
// Motion it stays at the start). Both go from 0 to 1; the thread maps them onto its own axis.
export function useThreadMotion(measured: boolean, waiting: boolean) {
  const reduced = useReducedMotion();
  const drawn = useSharedValue(reduced ? 1 : 0);
  const run = useSharedValue(0);

  // Drawn in once; growing or shrinking later keeps the drawn line.
  useEffect(() => {
    if (!measured) return;
    drawn.set(reduced ? 1 : withTiming(1, { duration: DRAW_MS, easing: EASE_OUT }));
  }, [measured, reduced, drawn]);
  useEffect(() => () => cancelAnimation(drawn), [drawn]);

  useEffect(() => {
    if (waiting && !reduced) {
      run.set(0);
      run.set(withRepeat(withTiming(1, { duration: RUN_MS, easing: EASE_OUT }), -1));
      return () => cancelAnimation(run);
    }
    // Stays where it is while it fades out; the next wait starts it from the beginning.
    cancelAnimation(run);
    if (reduced) run.set(0);
  }, [waiting, reduced, run]);

  return { drawn, run, reduced };
}

// The running bead fades out over the last stretch, so it doesn't jump back to the start.
export function runOpacity(run: number) {
  'worklet';
  return interpolate(run, [0, 0.85, 1], [1, 1, 0]);
}

// The running bead laid across, along the reading direction, so it mirrors in Hebrew.
export function runAcross(run: number, width: number) {
  'worklet';
  return {
    opacity: runOpacity(run),
    transform: [{ translateX: run * Math.max(0, width - BEAD) * (RTL ? -1 : 1) }],
  };
}

// The waiting bead on a line that runs across (a rail): put it inside the line, which it measures
// by itself. With Reduce Motion it stays still at the start. Decoration, so screen readers skip it.
export function BeadAcross({ waiting }: { waiting: boolean }) {
  const [width, setWidth] = useState(0);
  const { run } = useThreadMotion(false, waiting);
  const bead = useAnimatedStyle(() => runAcross(run.get(), width));
  return (
    <View
      style={styles.across}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {waiting && (
        <Animated.View
          testID="thread-waiting"
          style={[styles.acrossBead, bead]}
          exiting={FadeOut.duration(durations.state)}
        >
          <WaitingSign run={run} way="across" />
        </Animated.View>
      )}
    </View>
  );
}

type LineProps = {
  // How far above the column the line starts, and how long it is (both measured by the screen).
  top: number;
  length: number;
  // Something is waited for: a bead runs down the thread, the one sign of waiting app-wide.
  waiting: boolean;
  // When to draw the line in; by default once it has a length. The track is there before, so a
  // bead can run from the start.
  measured?: boolean;
  weight?: number;
  // Follow the stops when they slide (a field in or out, an error), so the line stays on the last
  // stop instead of jumping ahead of it. Off: it takes a new length at once.
  follow?: boolean;
  // Where the thread runs from the start edge, for a column with another THREAD_X.
  x?: number;
};

// The line itself, behind the stops of its column (render it first). Decoration (the stops say
// the same), so screen readers skip it. Placed with `start`, so it mirrors in RTL.
export function ThreadLine({
  top,
  length,
  waiting,
  measured = length > 0,
  weight = LINE_WEIGHT,
  follow = false,
  x = THREAD_X,
}: LineProps) {
  const { drawn, run, reduced } = useThreadMotion(measured, waiting);
  // Only a following line needs its size on the UI thread; otherwise it's sized in render.
  const height = useSharedValue(length);
  const track = useSharedValue(top);
  useEffect(() => {
    if (!follow) return;
    const jump = reduced || height.get() === 0;
    const slide = { duration: durations.state, easing: EASE_OUT };
    height.set(jump ? length : withTiming(length, slide));
    track.set(jump ? top : withTiming(top, slide));
  }, [length, top, follow, reduced, height, track]);
  useEffect(
    () => () => {
      cancelAnimation(height);
      cancelAnimation(track);
    },
    [height, track],
  );

  const line = useAnimatedStyle(() => ({ transform: [{ scaleY: drawn.get() }] }));
  const bead = useAnimatedStyle(() => ({
    opacity: runOpacity(run.get()),
    transform: [
      { translateY: run.get() * Math.max(0, (follow ? height.get() : length) - SIGN_REACH) },
    ],
  }));
  const size = useAnimatedStyle(() => ({ top: -track.get(), height: height.get() }));

  return (
    <Animated.View
      testID="thread-track"
      style={[styles.track, { start: x - BEAD / 2 }, follow ? size : { top: -top, height: length }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {measured && (
        <Animated.View
          testID="thread-line"
          style={[styles.line, { start: BEAD / 2 - weight / 2, width: weight }, line]}
        />
      )}
      {waiting && (
        <Animated.View
          testID="thread-waiting"
          style={[styles.bead, bead]}
          exiting={FadeOut.duration(durations.state)}
        >
          <WaitingSign run={run} way="down" />
        </Animated.View>
      )}
    </Animated.View>
  );
}

// bead: the cherry bead (something there, or to act on); empty: still to fill; optional: may stay
// empty (dashed).
export type DotKind = 'bead' | 'empty' | 'optional';

type StopProps = {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
} & (
  | {
      kind: DotKind;
      // Where the dot sits from the top of the stop, so it lines up with what the stop holds.
      dotY: number;
      weight?: number;
    }
  // Something in place of the dot (add-item's hanger), placed absolutely and hidden from screen
  // readers by the caller.
  | { marker: ReactNode }
);

// One stop on the thread: its dot on the line and what it holds, indented past the line.
export function ThreadStop(props: StopProps) {
  return (
    <View style={[styles.stop, props.style]}>
      {'marker' in props ? (
        props.marker
      ) : (
        <View
          testID="thread-dot"
          style={[
            styles.dot,
            { top: props.dotY, borderWidth: props.weight ?? LINE_WEIGHT },
            props.kind === 'bead' && styles.dotBead,
            props.kind === 'optional' && styles.dotOptional,
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute children sit from the column's outer edge, padding included.
  track: {
    position: 'absolute',
    width: BEAD,
    pointerEvents: 'none',
  },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: colors.text,
    transformOrigin: 'top',
  },
  bead: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: BEAD,
    height: BEAD,
  },
  across: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: '50%',
    height: 0,
    pointerEvents: 'none',
  },
  acrossBead: {
    position: 'absolute',
    top: -BEAD / 2,
    start: 0,
    width: BEAD,
    height: BEAD,
  },
  stop: {
    paddingTop: 10,
    paddingBottom: 16,
  },
  dot: {
    // Set, not left out: iOS keeps a dashed border once it's been dashed.
    borderStyle: 'solid',
    position: 'absolute',
    start: THREAD_X - INDENT - DOT / 2,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderColor: colors.text,
    backgroundColor: colors.background,
  },
  dotBead: {
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  dotOptional: {
    borderColor: colors.textMuted,
    borderStyle: 'dashed',
  },
});
