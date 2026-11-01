import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Hanger, HANGER_PIVOT_Y, HANGER_WIDTH } from '@/components/hanger';
import { durations, EASE_OUT } from '@/motion';
import { colors } from '@/theme';

// The hangers on the auth band, smaller than on a closet rail.
const HANGER = 54;
const PIVOT_Y = (HANGER_PIVOT_Y * HANGER) / HANGER_WIDTH;
// One sway from side to side, slow and small: the rail is breathing, not swinging.
const SWAY_MS = 3600;
const SWAY_DEG = 3;
// Each hanger is this far into its sway when the screen opens, so they never move in lockstep.
const SWAY_OFFSET_MS = 700;
// Silhouettes appear one after another, and how faint they are once they're there.
const FILL_STEP = 120;
const FAINT = 0.34;

// How visible a silhouette is, 0 (an empty hanger) to FAINT, for how far it has come in (0 to 1).
export function silhouetteOpacity(shown: number) {
  'worklet';
  return shown * FAINT;
}

// Faint pieces on the hangers, drawn on a 74×110 grid from the neck down: a tee, a dress, a long
// coat, a shirt and a knit. Shapes, not photos: they only say "your clothes go here".
const SILHOUETTES = [
  'M24 8 13 12 4 30l10 5 5-8v73h36V27l5 8 10-5-9-18-11-4q-13 8-26 0Z',
  'M27 8q10 6 20 0l3 2-1 22q-1 8 3 16l14 56H8l14-56q4-8 3-16l-1-22Z',
  'M25 7 12 11 7 50l-2 56h11l1-54 1 56h38l1-56 1 54h11l-2-56-5-39-13-4-12 21Z',
  'M25 8 12 12 5 60l8 2 6-32v62h36V30l6 32 8-2-7-48-13-4-12 8Z',
  'M24 9 11 14 6 66l9 2 4-36v52q18 4 36 0V32l4 36 9-2-5-52-13-5q-13 6-26 0Z',
];
const SILHOUETTE_WIDTH = 66;
const SILHOUETTE_HEIGHT = (SILHOUETTE_WIDTH * 110) / 74;

// The rail on the auth band (decided 2026-10-31, prototype `~/Desktop/closet/wrinkle-lab/design-adding`,
// "auth", direction "Выбрано"): empty hangers swaying on sign-up; on sign-in faint grey pieces
// appear on them one after another, and empty again when she goes back. Decoration (the caption
// under it says the same), so screen readers skip it.
export function AuthRail({ filled }: { filled: boolean }) {
  return (
    <View
      style={styles.rail}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.bar} />
      <View style={styles.hangers}>
        {SILHOUETTES.map((shape, index) => (
          <SwayingHanger key={index} index={index} shape={shape} filled={filled} />
        ))}
      </View>
    </View>
  );
}

function SwayingHanger({
  index,
  shape,
  filled,
}: {
  index: number;
  shape: string;
  filled: boolean;
}) {
  const reduced = useReducedMotion();
  const sway = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // Hangs straight (0.5 is the middle of the sway).
      cancelAnimation(sway);
      sway.set(0.5);
      return;
    }
    // Starts part of the way into its first sway, then swings back and forth for good.
    const start = ((index * SWAY_OFFSET_MS) % SWAY_MS) / SWAY_MS;
    const ease = Easing.inOut(Easing.sin);
    sway.set(start);
    sway.set(
      withSequence(
        withTiming(1, { duration: SWAY_MS * (1 - start), easing: ease }),
        withRepeat(withTiming(0, { duration: SWAY_MS, easing: ease }), -1, true),
      ),
    );
    return () => cancelAnimation(sway);
  }, [index, reduced, sway]);

  useEffect(() => {
    if (reduced) {
      shown.set(filled ? 1 : 0);
      return;
    }
    shown.set(
      withDelay(
        index * FILL_STEP,
        withTiming(filled ? 1 : 0, {
          duration: filled ? durations.enter : 600,
          easing: EASE_OUT,
        }),
      ),
    );
  }, [filled, index, reduced, shown]);

  const turn = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(sway.get() * 2 - 1) * SWAY_DEG}deg` }],
  }));
  const piece = useAnimatedStyle(() => ({
    opacity: silhouetteOpacity(shown.get()),
    transform: [{ translateY: (shown.get() - 1) * 10 }],
  }));

  return (
    <Animated.View style={[styles.cell, turn]}>
      <Animated.View testID="auth-rail-piece" style={[styles.silhouette, piece]}>
        <Svg
          width={SILHOUETTE_WIDTH}
          height={SILHOUETTE_HEIGHT}
          viewBox="0 0 74 110"
          fill={colors.iconMuted}
          aria-hidden
        >
          <Path d={shape} />
        </Svg>
      </Animated.View>
      <Hanger kind="coat" width={HANGER} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: {
    height: 150,
    marginTop: 4,
  },
  bar: {
    position: 'absolute',
    top: 30,
    start: 26,
    end: 26,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  hangers: {
    position: 'absolute',
    top: 22,
    start: 36,
    end: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Turns around the hook, where it hangs on the bar.
  cell: {
    width: HANGER,
    transformOrigin: ['50%', PIVOT_Y, 0],
  },
  // Under the hanger, its shoulders on the hanger's.
  silhouette: {
    position: 'absolute',
    top: 4,
    start: (HANGER - SILHOUETTE_WIDTH) / 2,
  },
});
