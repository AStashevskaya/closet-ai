import type { ItemCategory } from '@closet-ai/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Hanger, HANGER_HEIGHT, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

// Where the thread runs, from the start edge of the column, and where the stops' content starts.
const THREAD_X = 9;
const INDENT = 34;
// How far the thread reaches up into the blue band, so it leaves from under the print.
const REACH_UP = 26;
// Where a stop's dot sits, from the top of the stop.
const DOT_Y = 15;
const DOT = 9;
const BEAD = 10;
// The hanger on the last stop, drawn at half size; the thread ends where its hook starts.
const HANGER_SCALE = 0.5;
const HOOK_Y = 6;
const DRAW_MS = 2000;
const RUN_MS = 2400;

// filled: a value is there (the cherry bead); empty: nothing yet; optional: may stay empty (dashed).
export type StopKind = 'filled' | 'empty' | 'optional';

type ThreadProps = {
  // The photo is being read: a bead runs down the thread, the one sign of waiting app-wide.
  waiting: boolean;
  // The rail the piece will hang on, the last stop: the thread ends at its hanger.
  rail: ReactNode;
  children: ReactNode;
};

// The add-item fields as stops on one thread (decided 2026-10-31, prototype
// `~/Desktop/closet/wrinkle-lab/design-adding`, "one piece", direction "Выбрано"): it leaves the
// photo in the blue band and ends at the rail the piece will hang on, so the line means what it
// does everywhere, a piece and its rail. The line and the bead are decoration (the stops' labels
// say the same), so screen readers skip them. Positioned with start/end, so it mirrors in RTL.
export function FieldThread({ waiting, rail, children }: ThreadProps) {
  const reduceMotion = useReducedMotion();
  // Where the hanger's hook is, from the top of the column: measured from the rail stop.
  const [end, setEnd] = useState(0);
  const length = end + REACH_UP;
  const drawn = useSharedValue(reduceMotion ? 1 : 0);
  const run = useSharedValue(0);
  // A short fade as the fields settle when the photo has been read; the screen doesn't enter again.
  const settle = useSharedValue(1);
  const wasWaiting = useRef(waiting);

  // Drawn in once, when the column first has a height; growing later keeps the drawn line.
  const measured = end > 0;
  useEffect(() => {
    if (!measured) return;
    drawn.value = reduceMotion ? 1 : withTiming(1, { duration: DRAW_MS, easing: EASE_OUT });
  }, [measured, reduceMotion, drawn]);

  useEffect(() => {
    if (waiting && !reduceMotion) {
      run.value = 0;
      run.value = withRepeat(withTiming(1, { duration: RUN_MS, easing: EASE_OUT }), -1);
    } else {
      cancelAnimation(run);
      run.value = 0;
    }
    if (wasWaiting.current && !waiting && !reduceMotion) {
      settle.value = withSequence(
        withTiming(0.4, { duration: 0 }),
        withTiming(1, { duration: durations.state, easing: EASE_OUT }),
      );
    }
    wasWaiting.current = waiting;
  }, [waiting, reduceMotion, run, settle]);

  const line = useAnimatedStyle(() => ({ transform: [{ scaleY: drawn.value }] }));
  const bead = useAnimatedStyle(() => ({
    opacity: interpolate(run.value, [0, 0.85, 1], [1, 1, 0]),
    transform: [{ translateY: run.value * Math.max(0, length - BEAD) }],
  }));
  const fade = useAnimatedStyle(() => ({ opacity: settle.value }));

  return (
    <View style={styles.column}>
      {/* Always there, so the bead runs from the start; the line draws in once it's measured. */}
      <View
        style={[styles.track, { height: length }]}
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
      <Animated.View style={fade}>
        {children}
        <View
          onLayout={(event) => setEnd(Math.round(event.nativeEvent.layout.y) + HOOK_Y)}
          style={styles.railStop}
        >
          {rail}
        </View>
      </Animated.View>
    </View>
  );
}

type StopProps = {
  kind: StopKind;
  label: string;
  children: ReactNode;
};

// One field on the thread: its dot, a small label and the field itself.
export function Stop({ kind, label, children }: StopProps) {
  return (
    <View style={styles.stop}>
      <View
        style={[
          styles.dot,
          kind === 'filled' && styles.dotFilled,
          kind === 'optional' && styles.dotOptional,
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// The last stop: the hanger of the rail picked (a coat hanger for tops, a clip for bottoms…)
// where the dot would be, so the thread ends on a rail.
export function RailStop({
  category,
  label,
  children,
}: {
  category: ItemCategory | null;
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.stop}>
      <View
        style={styles.hanger}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Hanger kind={HANGERS[category ?? 'top']} />
      </View>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  column: {
    marginTop: 0,
    marginHorizontal: 20,
    paddingStart: INDENT,
  },
  // Absolute children sit from the column's outer edge, padding included.
  track: {
    position: 'absolute',
    top: -REACH_UP,
    start: THREAD_X - BEAD / 2,
    width: BEAD,
    pointerEvents: 'none',
  },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: BEAD / 2 - 0.6,
    width: 1.2,
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
    gap: 6,
  },
  railStop: {
    paddingBottom: 8,
  },
  dot: {
    position: 'absolute',
    top: DOT_Y,
    start: THREAD_X - INDENT - DOT / 2,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.background,
  },
  dotFilled: {
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  dotOptional: {
    borderColor: colors.textMuted,
    borderStyle: 'dashed',
  },
  // Scaled around its centre, so the box is placed by its full size and the hook lands on the thread.
  hanger: {
    position: 'absolute',
    top: HOOK_Y - (HANGER_HEIGHT * (1 - HANGER_SCALE)) / 2,
    start: THREAD_X - INDENT - HANGER_WIDTH / 2,
    width: HANGER_WIDTH,
    height: HANGER_HEIGHT,
    transform: [{ scale: HANGER_SCALE }],
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
});
