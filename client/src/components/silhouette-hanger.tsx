import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
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

import { Hanger, HANGER_PIVOT_Y, HANGER_WIDTH, type HangerKind } from '@/components/hanger';
import { durations, EASE_OUT } from '@/motion';
import { colors } from '@/theme';

// One sway from side to side, slow and small: the rail is breathing, not swinging.
const SWAY_MS = 3600;
const SWAY_DEG = 3;
// Each hanger is this far into its sway when it appears, so they never move in lockstep.
const SWAY_OFFSET_MS = 700;
// Silhouettes appear one after another, and how faint they are once they're there.
const FILL_STEP = 120;
const FAINT = 0.34;

// How visible a silhouette is, 0 (an empty hanger) to FAINT, for how far it has come in (0 to 1).
export function silhouetteOpacity(shown: number) {
  'worklet';
  return shown * FAINT;
}

// Faint clothes drawn on a 74×110 grid from the neck (or the waist) down. Shapes, not photos:
// they only say "your clothes go here".
export const SILHOUETTES = {
  tee: 'M24 8 13 12 4 30l10 5 5-8v73h36V27l5 8 10-5-9-18-11-4q-13 8-26 0Z',
  dress: 'M27 8q10 6 20 0l3 2-1 22q-1 8 3 16l14 56H8l14-56q4-8 3-16l-1-22Z',
  coat: 'M25 7 12 11 7 50l-2 56h11l1-54 1 56h38l1-56 1 54h11l-2-56-5-39-13-4-12 21Z',
  shirt: 'M25 8 12 12 5 60l8 2 6-32v62h36V30l6 32 8-2-7-48-13-4-12 8Z',
  knit: 'M24 9 11 14 6 66l9 2 4-36v52q18 4 36 0V32l4 36 9-2-5-52-13-5q-13 6-26 0Z',
  trousers: 'M14 10h46l3 96H44L37 40 30 106H11Z',
  skirt: 'M20 10h34l16 72q-33 8-66 0Z',
  shorts: 'M16 10h42l5 40H11Z',
} as const;
export type Silhouette = keyof typeof SILHOUETTES;

const SILHOUETTE_WIDTH = 66;
const SILHOUETTE_HEIGHT = (SILHOUETTE_WIDTH * 110) / 74;

type Props = {
  shape: Silhouette;
  // Its place on the rail: staggers the sway and the silhouette's coming in.
  index: number;
  // Whether the silhouette is on the hanger (false: an empty hanger).
  filled: boolean;
  kind?: HangerKind;
  // The hanger's width; the silhouette is a little wider, its shoulders on the hanger's.
  width?: number;
  testID?: string;
};

// A hanger swaying on a rail with a faint piece on it (decided 2026-10-31 for the auth band, and
// 2026-11-11 for the empty closet). Decoration: whoever draws it labels the rail for screen readers.
export function SilhouetteHanger({
  shape,
  index,
  filled,
  kind = 'coat',
  width = 54,
  testID,
}: Props) {
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

  const scale = width / 54;
  return (
    <Animated.View
      style={[
        { width, transformOrigin: ['50%', (HANGER_PIVOT_Y * width) / HANGER_WIDTH, 0] },
        turn,
      ]}
    >
      <Animated.View
        testID={testID}
        style={[
          styles.silhouette,
          { top: 4 * scale, start: ((54 - SILHOUETTE_WIDTH) / 2) * scale },
          piece,
        ]}
      >
        <Svg
          width={SILHOUETTE_WIDTH * scale}
          height={SILHOUETTE_HEIGHT * scale}
          viewBox="0 0 74 110"
          fill={colors.iconMuted}
          aria-hidden
        >
          <Path d={SILHOUETTES[shape]} />
        </Svg>
      </Animated.View>
      <Hanger kind={kind} width={width} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Under the hanger, its shoulders on the hanger's.
  silhouette: {
    position: 'absolute',
  },
});
