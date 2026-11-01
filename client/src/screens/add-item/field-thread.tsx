import type { ItemCategory } from '@closet-ai/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Hanger, HANGER_HEIGHT, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { INDENT, THREAD_X, ThreadLine, ThreadStop } from '@/components/thread-stops';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

// How far the thread reaches up into the blue band, so it leaves from under the print.
const REACH_UP = 26;
// Where a stop's dot sits, from the top of the stop.
const DOT_Y = 15;
// The hanger on the last stop, drawn at half size; the thread ends where its hook starts.
const HANGER_SCALE = 0.5;
const HOOK_Y = 6;

// filled: a value is there (the cherry bead); empty: nothing yet; optional: may stay empty (dashed).
export type StopKind = 'filled' | 'empty' | 'optional';

type ThreadProps = {
  // The photo is being read: a bead runs down the thread, the one sign of waiting app-wide.
  waiting: boolean;
  // The photo's tags filled the fields in: they settle with a short fade as the bead goes. Not
  // when reading timed out or failed, where nothing on the thread changed.
  filled: boolean;
  // The rail the piece will hang on, the last stop: the thread ends at its hanger.
  rail: ReactNode;
  children: ReactNode;
};

// The add-item fields as stops on one thread (decided 2026-10-31, prototype
// `~/Desktop/closet/wrinkle-lab/design-adding`, "one piece", direction "Выбрано"): it leaves the
// photo in the blue band and ends at the rail the piece will hang on, so the line means what it
// does everywhere, a piece and its rail. The line and its bead are `ThreadLine`; what's this
// screen's own is the hanger at the end and the fields settling when the photo has been read.
export function FieldThread({ waiting, filled, rail, children }: ThreadProps) {
  const reduceMotion = useReducedMotion();
  // Where the hanger's hook is, from the top of the column: measured from the rail stop.
  const [end, setEnd] = useState(0);
  // A short fade as the fields settle when the photo has been read; the screen doesn't enter again.
  const settle = useSharedValue(1);
  const wasWaiting = useRef(waiting);

  useEffect(() => {
    if (wasWaiting.current && !waiting && filled && !reduceMotion) {
      settle.set(
        withSequence(
          withTiming(0.4, { duration: 0 }),
          withTiming(1, { duration: durations.state, easing: EASE_OUT }),
        ),
      );
    }
    wasWaiting.current = waiting;
  }, [waiting, filled, reduceMotion, settle]);

  const fade = useAnimatedStyle(() => ({ opacity: settle.get() }));

  return (
    <View style={styles.column}>
      {/* Always there, so the bead runs from the start; the line draws in once it's measured. */}
      <ThreadLine top={REACH_UP} length={end + REACH_UP} measured={end > 0} waiting={waiting} />
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
    <ThreadStop kind={kind === 'filled' ? 'bead' : kind} dotY={DOT_Y} style={styles.stop}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </ThreadStop>
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
    <ThreadStop
      style={styles.stop}
      marker={
        <View
          style={styles.hanger}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Hanger kind={HANGERS[category ?? 'top']} />
        </View>
      }
    >
      <Text style={styles.label}>{label}</Text>
      {children}
    </ThreadStop>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  column: {
    marginTop: 0,
    marginHorizontal: 20,
    paddingStart: INDENT,
  },
  stop: {
    gap: 6,
  },
  railStop: {
    paddingBottom: 8,
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
