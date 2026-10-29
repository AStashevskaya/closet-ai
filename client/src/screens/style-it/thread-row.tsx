import { useEffect, useState, type ReactNode } from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { EASE_OUT } from '@/motion';
import { colors } from '@/theme';

// Where the thread runs (from the start edge of the row) and where the content starts.
export const THREAD_X = 14;
export const THREAD_INDENT = 36;
// Where a branch reaches the content: level with an outfit's "01 / 03".
const BRANCH_Y = 22;
// The knot on top, where the thread leaves the chosen piece.
const KNOT_Y = 26;
const DRAW = 900;

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  // root: the chosen piece, a knot where the thread starts; branch: an outfit hanging off it.
  kind: 'root' | 'branch';
  // The last row: the thread ends at its branch instead of running on.
  last?: boolean;
  // A branch to something that isn't hers (an outfit she said no to): dashed, as on Inspiration.
  loose?: boolean;
  // A root below another row (a stop in Style it's diary): the thread comes down into its knot.
  joined?: boolean;
  // A root whose outfits are folded away: an open knot instead of the bead.
  hollow?: boolean;
  delay?: number;
  children: ReactNode;
};

// One row of Style it's thread (decided 2026-10-26: the piece on top, its outfits each full width
// below, so pieces don't shrink): the thread runs down the start edge and branches into each outfit.
// The line draws itself in, row after row; it's decoration (the order says the same), so screen
// readers skip it. Mirrored in RTL, where the thread runs down the right edge.
export function ThreadRow({
  kind,
  last = false,
  loose = false,
  joined = false,
  hollow = false,
  delay = 0,
  children,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  const { d, length } = threadPath(kind, last, height, joined);
  const branch = loose ? branchPath(height, last) : null;

  // Drawn once, when the row first has a height (a row growing later keeps its drawn line).
  const measured = height > 0;
  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    if (!measured) return;
    progress.value = withDelay(delay, withTiming(1, { duration: DRAW, easing: EASE_OUT }));
  }, [measured, delay, reduceMotion, progress]);

  const line = useAnimatedProps(
    () => ({
      strokeDashoffset: length * (1 - progress.value),
      strokeOpacity: progress.value > 0 ? 1 : 0,
    }),
    [length],
  );
  // A dashed line can't be drawn in by its dash: it fades in instead.
  const dashed = useAnimatedProps(() => ({ strokeOpacity: progress.value }));

  return (
    <View
      style={styles.row}
      onLayout={(event) => setHeight(Math.round(event.nativeEvent.layout.height))}
    >
      {height > 0 && (
        <View
          style={[styles.thread, I18nManager.isRTL && styles.mirrored]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width={THREAD_INDENT} height={height}>
            <AnimatedPath
              d={branch ? branch.down : d}
              animatedProps={line}
              fill="none"
              stroke={colors.text}
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeDasharray={[length, length]}
            />
            {branch && (
              <AnimatedPath
                d={branch.out}
                animatedProps={dashed}
                fill="none"
                stroke={colors.textMuted}
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeDasharray={[3, 5]}
              />
            )}
            {kind === 'root' && (
              <Circle
                cx={THREAD_X}
                cy={KNOT_Y}
                r={5}
                fill={hollow ? colors.background : colors.bead}
                stroke={colors.text}
                strokeWidth={1}
              />
            )}
          </Svg>
        </View>
      )}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// The thread in a row of this height, and its length (for drawing it in by its dash).
export function threadPath(kind: 'root' | 'branch', last: boolean, height: number, joined = false) {
  const x = THREAD_X;
  const reach = THREAD_INDENT - 6;
  if (kind === 'root') {
    // From the piece's edge into the knot, then down the whole row (or ending at the knot, if
    // last); joined, the thread from above runs into the knot too.
    const tie = reach - x;
    const end = last ? KNOT_Y : height;
    const above = joined ? `M${x} 0V${KNOT_Y}` : '';
    return {
      d: `${above}M${reach} ${KNOT_Y}H${x}V${end}`,
      length: tie + (end - KNOT_Y) + (joined ? KNOT_Y : 0) + 2,
    };
  }
  // Down to the branch, curving into the content; on past it unless this is the last row.
  const bend = `M${x} 0V${BRANCH_Y - 14}C${x} ${BRANCH_Y} ${x + 4} ${BRANCH_Y} ${reach} ${BRANCH_Y}`;
  const bendLength = BRANCH_Y - 14 + 1.25 * Math.hypot(reach - x, 14);
  if (last) return { d: bend, length: Math.ceil(bendLength) + 2 };
  return {
    d: `${bend}M${x} ${BRANCH_Y - 14}V${height}`,
    length: Math.ceil(bendLength + height) + 2,
  };
}

// A loose branch: the thread runs on down (to the bend only, if last), the bend out dashed.
function branchPath(height: number, last: boolean) {
  const x = THREAD_X;
  const reach = THREAD_INDENT - 6;
  return {
    down: `M${x} 0V${last ? BRANCH_Y - 14 : height}`,
    out: `M${x} ${BRANCH_Y - 14}C${x} ${BRANCH_Y} ${x + 4} ${BRANCH_Y} ${reach} ${BRANCH_Y}`,
  };
}

const styles = StyleSheet.create({
  row: {
    paddingStart: THREAD_INDENT,
  },
  thread: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    width: THREAD_INDENT,
    pointerEvents: 'none',
  },
  // In RTL the column sits at the right edge and the branches curve leftwards into the content.
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  content: {
    flex: 1,
  },
});
