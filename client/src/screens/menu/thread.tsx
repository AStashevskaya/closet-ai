import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';

import { rise, STAGGER_STEP, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

// The thread is drawn down from the first stop, slowly, as the stops come up along it.
const drawDown = new Keyframe({
  0: { transform: [{ scaleY: 0 }] },
  100: { transform: [{ scaleY: 1 }], easing: EASE_OUT },
}).duration(2000);

// "Your thread" (The Thread, 2026-10-26): a vertical line with stops, the first one a bead.
// The line and the dots sit at the start, so the thread runs down the right side in Hebrew.
export function ProfileThread({ children }: { children: ReactNode }) {
  return (
    <View style={styles.spine}>
      <Animated.View
        entering={drawDown}
        style={styles.line}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      />
      {children}
    </View>
  );
}

type StopProps = {
  // Its place on the thread, for the stagger; the first one is today, a bead.
  index: number;
  note: string;
  big: string;
  children?: ReactNode;
};

export function Stop({ index, note, big, children }: StopProps) {
  return (
    <Animated.View entering={rise.delay(STAGGER_STEP * (index + 1))} style={styles.stop} accessible>
      <View style={[styles.dot, index === 0 && styles.bead]} />
      <Text style={styles.note}>{note}</Text>
      <Text style={styles.big}>{big}</Text>
      {children}
    </Animated.View>
  );
}

const DOT = 11;
const LINE_START = 26;

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  spine: {
    marginHorizontal: 20,
    paddingStart: LINE_START,
  },
  line: {
    position: 'absolute',
    start: 5,
    top: 6,
    bottom: 22,
    width: 1.2,
    backgroundColor: colors.text,
    transformOrigin: 'top',
  },
  stop: {
    paddingBottom: 22,
    gap: 2,
  },
  dot: {
    position: 'absolute',
    start: -LINE_START,
    top: 4,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.background,
  },
  bead: {
    backgroundColor: colors.bead,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'left',
  },
  big: {
    fontFamily: fonts.displayLight,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'left',
  },
});
