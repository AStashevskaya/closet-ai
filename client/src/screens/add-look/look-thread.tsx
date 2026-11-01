import { useState } from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';

import { BEAD, runOpacity, useThreadMotion } from '@/components/thread-stops';
import { durations } from '@/motion';
import { colors } from '@/theme';

const DOT = 12;
// Read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
const RTL = I18nManager.isRTL;

type Props = {
  // waiting: the photo is being read; strung: the pieces found, one bead each; unread: the photo
  // couldn't be read, or nothing was found on it.
  state: 'waiting' | 'strung' | 'unread';
  // One per piece found: whether it will be added.
  pieces: boolean[];
};

// The look's thread, under the photo: its pieces strung on it as beads, full for a piece she'll
// add and dashed for one left out (as in Recreate the look). While the photo is read a bead runs
// along it, the one sign of waiting app-wide (docs/design.md, "Waiting"); a photo that couldn't
// be read leaves it dashed. Along the reading direction, so it mirrors in Hebrew. Decoration: the
// note under it and the labels on the photo say the same, so screen readers skip it.
// It moves like every thread (`useThreadMotion`), but it's laid across, with its beads in a row
// rather than as stops down a column, so it doesn't use `ThreadLine` / `ThreadStop`.
export function LookThread({ state, pieces }: Props) {
  const [width, setWidth] = useState(0);
  const waiting = state === 'waiting';
  // Drawn in from the start: it spans the screen, so there's nothing to measure first.
  const { drawn, run } = useThreadMotion(true, waiting);

  const line = useAnimatedStyle(() => ({ transform: [{ scaleX: drawn.get() }] }));
  const bead = useAnimatedStyle(() => ({
    opacity: runOpacity(run.get()),
    transform: [{ translateX: run.get() * Math.max(0, width - BEAD) * (RTL ? -1 : 1) }],
  }));

  return (
    <View
      style={styles.thread}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {state === 'unread' ? (
        // Drawn in SVG: iOS doesn't dash a border on one side only.
        <Svg style={styles.dashed} width={width} height={2} testID="thread-unread">
          <Line
            x1={0}
            y1={1}
            x2={width}
            y2={1}
            stroke={colors.textMuted}
            strokeWidth={1.2}
            strokeDasharray={[4, 4]}
          />
        </Svg>
      ) : (
        <Animated.View style={[styles.line, line]} />
      )}
      {waiting && (
        <Animated.View
          style={[styles.runner, bead]}
          exiting={FadeOut.duration(durations.state)}
          testID="thread-waiting"
        />
      )}
      {state === 'strung' &&
        pieces.map((on, index) => (
          <Animated.View
            key={index}
            style={[styles.dot, on ? styles.dotOn : styles.dotOff]}
            entering={FadeIn.duration(durations.state).delay(index * 60)}
            testID={on ? 'bead-on' : 'bead-off'}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  thread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: DOT + 8,
  },
  line: {
    position: 'absolute',
    start: 0,
    end: 0,
    top: '50%',
    height: 1.2,
    backgroundColor: colors.text,
    transformOrigin: RTL ? 'right' : 'left',
  },
  // Not read: a dashed line, still; the waiting bead is the only thing that moves by itself.
  dashed: {
    position: 'absolute',
    start: 0,
    top: '50%',
    marginTop: -1,
  },
  runner: {
    position: 'absolute',
    start: 0,
    top: '50%',
    marginTop: -BEAD / 2,
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    backgroundColor: colors.bead,
  },
  dot: {
    // Set, not left out: iOS keeps a dashed border once it's been dashed.
    borderStyle: 'solid',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.2,
  },
  dotOn: {
    borderColor: colors.text,
    backgroundColor: colors.bead,
  },
  dotOff: {
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    backgroundColor: colors.background,
  },
});
