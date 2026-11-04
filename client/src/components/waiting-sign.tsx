import { I18nManager, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { colors } from '@/theme';

// The one sign of waiting (docs/design.md, "Waiting"): the cherry tag from `HangerLoader`, moved onto
// the screen's own thread. This is the only place it's drawn, so changing the sign changes it here.
// The caller moves the box it sits in along the thread; the tag only swings.

// The box the thread moves along (its centre is on the thread).
export const SIGN_BOX = 10;
const CENTRE = SIGN_BOX / 2;
const TAG_WIDTH = 12;
const TAG_HEIGHT = 19;
// Where a tag on a thread running down hangs from: a loop out to the side, so it hangs down like
// everything else on the app's rails, instead of lying along the thread or sticking out sideways.
const LOOP_OUT = 8;
const LOOP_DOWN = 1;
// How far below the top of its box a tag on a thread running down reaches: a thread stops its run
// this far from its end, so the tag stays on the thread instead of over what's below it.
export const SIGN_REACH = CENTRE + LOOP_DOWN + TAG_HEIGHT;
// How far it swings at the start of a run, and how many half swings a run has. It runs on the run's
// own value, so it needs no animation of its own and settles as the tag slows down, like the pieces
// on a rail. A thread running down moves it along its length, so it sways less.
const SWING_DEG = 34;
const SWING_DOWN = 0.4;
const SWINGS = 7;
// Read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
const RTL = I18nManager.isRTL;

type Props = {
  // How far along the thread it is, from 0 to 1, eased (`useThreadMotion`).
  run: SharedValue<number>;
  way: 'across' | 'down';
};

export function WaitingSign({ run, way }: Props) {
  const reduced = useReducedMotion();
  const down = way === 'down';
  const swing = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ rotate: '0deg' }] };
    // The run is eased, so what's left of it gives how fast the tag still goes.
    const left = Math.max(0, 1 - run.get());
    const amount = SWING_DEG * (down ? SWING_DOWN : 1) * Math.pow(left, 2 / 3);
    const angle = -amount * Math.cos(SWINGS * Math.PI * (1 - Math.cbrt(left)));
    return { transform: [{ rotate: `${RTL ? -angle : angle}deg` }] };
  });

  return (
    <View style={styles.sign} pointerEvents="none" testID="waiting-tag">
      {down && (
        <Svg style={styles.loop} width={LOOP_OUT + 1} height={5}>
          <Path d="M0 2 Q4 -1 8 3" fill="none" stroke={colors.text} strokeWidth={1} />
        </Svg>
      )}
      <Animated.View style={[styles.tag, down && styles.tagDown, swing]}>
        <Svg width={TAG_WIDTH} height={TAG_HEIGHT}>
          <Line x1={6} y1={0} x2={6} y2={6} stroke={colors.text} strokeWidth={1} />
          <Path d="M6 5 L10.4 8.6 L10.4 17 L1.6 17 L1.6 8.6 Z" fill={colors.bead} />
          <Circle cx={6} cy={9.2} r={1} fill={colors.onBead} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sign: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: SIGN_BOX,
    height: SIGN_BOX,
  },
  loop: {
    position: 'absolute',
    top: CENTRE - 2,
    start: CENTRE,
    // Drawn left to right: mirrored with the thread in Hebrew.
    transform: [{ scaleX: RTL ? -1 : 1 }],
  },
  // Swings from the top of its string, on the thread.
  tag: {
    position: 'absolute',
    top: CENTRE,
    start: CENTRE - TAG_WIDTH / 2,
    width: TAG_WIDTH,
    height: TAG_HEIGHT,
    transformOrigin: '50% 0%',
  },
  tagDown: {
    top: CENTRE + LOOP_DOWN,
    start: CENTRE + LOOP_OUT - TAG_WIDTH / 2,
  },
});
