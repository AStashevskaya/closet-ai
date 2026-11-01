import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
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

// The thread of the auth screens: from the title's bead on the blue band down through the fields
// to the button, the bead at its end. The same approach as the add-item fields' thread
// (`screens/add-item/field-thread.tsx`, PR #101); kept separate until that one is merged, then the
// line and the stop can be shared.

// Where the thread runs, from the start edge of the column, and where the stops' content starts.
export const THREAD_X = 9;
export const INDENT = 34;
export const DOT = 9;
const BEAD = 10;
const DRAW_MS = 2000;
const RUN_MS = 2400;

type LineProps = {
  // How far above the column the line starts, and how long it is (both measured by the screen).
  top: number;
  length: number;
  // Submitting: a bead runs down the thread, the one sign of waiting app-wide.
  waiting: boolean;
};

// The line itself, behind the stops of its column (render it first). It draws itself in once
// it's measured; growing or shrinking later (a field more or less) keeps it drawn. Decoration, so
// screen readers skip it. Placed with `start`, so it mirrors in RTL.
export function ThreadLine({ top, length, waiting }: LineProps) {
  const reduced = useReducedMotion();
  const drawn = useSharedValue(reduced ? 1 : 0);
  const run = useSharedValue(0);
  const measured = length > 0;

  useEffect(() => {
    if (!measured) return;
    drawn.set(reduced ? 1 : withTiming(1, { duration: DRAW_MS, easing: EASE_OUT }));
  }, [measured, reduced, drawn]);

  useEffect(() => {
    if (waiting && !reduced) {
      run.set(0);
      run.set(withRepeat(withTiming(1, { duration: RUN_MS, easing: EASE_OUT }), -1));
    } else {
      cancelAnimation(run);
      run.set(0);
    }
  }, [waiting, reduced, run]);

  const line = useAnimatedStyle(() => ({ transform: [{ scaleY: drawn.get() }] }));
  const bead = useAnimatedStyle(() => ({
    opacity: interpolate(run.get(), [0, 0.85, 1], [1, 1, 0]),
    transform: [{ translateY: run.get() * Math.max(0, length - BEAD) }],
  }));

  return (
    <View
      style={[styles.track, { top: -top, height: length }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {measured && <Animated.View style={[styles.line, line]} />}
      {waiting && (
        <Animated.View
          testID="thread-waiting"
          style={[styles.bead, bead]}
          exiting={FadeOut.duration(durations.state)}
        />
      )}
    </View>
  );
}

type StopProps = {
  // bead: the cherry bead (the title, the button, a field filled in); empty: a field still to fill.
  kind: 'bead' | 'empty';
  // Where the dot sits from the top of the stop, so it lines up with what the stop holds.
  dotY: number;
  children: ReactNode;
};

// One stop on the thread: its dot on the line and what it holds, indented past the line.
export function Stop({ kind, dotY, children }: StopProps) {
  return (
    <View style={styles.stop}>
      <View
        style={[styles.dot, { top: dotY }, kind === 'bead' && styles.dotBead]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolute children sit from the column's outer edge, padding included.
  track: {
    position: 'absolute',
    start: THREAD_X - BEAD / 2,
    width: BEAD,
    pointerEvents: 'none',
  },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: BEAD / 2 - 0.7,
    width: 1.4,
    backgroundColor: colors.text,
    transformOrigin: 'top',
  },
  bead: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    backgroundColor: colors.bead,
  },
  stop: {
    paddingTop: 10,
    paddingBottom: 16,
  },
  dot: {
    position: 'absolute',
    start: THREAD_X - INDENT - DOT / 2,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.4,
    borderColor: colors.text,
    backgroundColor: colors.background,
  },
  dotBead: {
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
});
