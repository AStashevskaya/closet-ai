import { useEffect, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { RAIL_WEIGHT, RailLine } from '@/components/rail-line';
import { launchDone, launchRailY, onLaunchRail } from '@/lib/launch';
import { durations } from '@/motion';
import { colors } from '@/theme';

// The launch screen's picture, as app.json gives it to expo-splash-screen: 150 pt wide, centred.
const SPLASH = require('../../assets/images/splash-icon.png');
const SIZE = 150;
// Where the picture draws the hanger's bottom bar, in its 150 pt square (from the 1024 grid of
// assets/icon-source/art.cjs: the bar's middle at y 716, ends at x 172 and 852, 46 thick).
const BAR = { x: 25, y: 105, width: 100, thick: 6.7 };
// The hook's top, where the hanger turns when it swings.
const PIVOT = '50% 28%';
// No hanger is left waiting longer than this for the first rail to say where it is.
const RAIL_WAIT_MS = 300;
// Past this, the bead runs along a rail under the hanger: the app is alive, just waiting.
const SLOW_MS = 900;

const ease = Easing.bezier(0.65, 0, 0.35, 1);

// The curtain over the app at launch ("Запуск", decided 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-launch`, direction B): an exact copy of the launch screen,
// so the system one can go unnoticed, whose hanger swings once while the app loads; when it's
// ready the hanger fades, its bottom bar stretches into a thread across the screen and settles on
// the first rail, and the blue melts away over the closet. With Reduce Motion it just fades.
// Decoration: screen readers skip it, and touches go through.
export function LaunchCurtain({ ready, onShown }: { ready: boolean; onShown: () => void }) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [swung, setSwung] = useState(reduced);
  const [slow, setSlow] = useState(false);
  const [gone, setGone] = useState(false);

  const turn = useSharedValue(0);
  const picture = useSharedValue(1);
  const ground = useSharedValue(1);
  const bar = useSharedValue(0);
  const stretch = useSharedValue(0);
  const rise = useSharedValue(0);
  const target = useSharedValue(0);

  const left = (width - SIZE) / 2;
  const top = (height - SIZE) / 2;
  const barMiddle = top + BAR.y;

  // While the app loads: one swing, as a hanger nudged on a rail.
  useEffect(() => {
    if (reduced) return;
    turn.set(
      withSequence(
        withTiming(7, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(-4, { duration: 220 }),
        withTiming(2, { duration: 180 }),
        withTiming(0, { duration: 180 }, () => scheduleOnRN(setSwung, true)),
      ),
    );
  }, [reduced, turn]);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!ready || !swung) return;
    let started = false;
    const finish = () => {
      launchDone();
      setGone(true);
    };
    const go = () => {
      if (started) return;
      started = true;
      if (reduced) {
        picture.set(withTiming(0, { duration: durations.state }));
        ground.set(withTiming(0, { duration: durations.state }, () => scheduleOnRN(finish)));
        return;
      }
      const railY = launchRailY();
      // A rail on screen to land on; else the thread just melts with the blue.
      const lands = railY !== null && railY > 0 && railY < height;
      target.set(lands ? railY : barMiddle);
      bar.set(1);
      picture.set(withTiming(0, { duration: 220 }));
      stretch.set(withTiming(1, { duration: 320, easing: ease }));
      rise.set(withDelay(320, withTiming(1, { duration: lands ? 380 : 0, easing: ease })));
      ground.set(
        withDelay(
          lands ? 700 : 420,
          withTiming(0, { duration: 300 }, () => scheduleOnRN(finish)),
        ),
      );
      // The thread goes as the blue does: the rail under it is drawn by then.
      bar.set(withDelay(lands ? 760 : 420, withTiming(0, { duration: 240 })));
    };
    if (launchRailY() !== null) {
      go();
      return;
    }
    const off = onLaunchRail(go);
    const timer = setTimeout(go, RAIL_WAIT_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [ready, swung, reduced, height, barMiddle, picture, ground, bar, stretch, rise, target]);

  const hangerStyle = useAnimatedStyle(() => ({
    opacity: picture.get(),
    transform: [{ rotate: `${turn.get()}deg` }],
  }));
  const groundStyle = useAnimatedStyle(() => ({ opacity: ground.get() }));
  const barStyle = useAnimatedStyle(() => {
    const thick = interpolate(stretch.get(), [0, 1], [BAR.thick, RAIL_WEIGHT]);
    const middle = interpolate(rise.get(), [0, 1], [barMiddle, target.get()]);
    return {
      opacity: bar.get(),
      left: interpolate(stretch.get(), [0, 1], [left + BAR.x, 0]),
      width: interpolate(stretch.get(), [0, 1], [BAR.width, width]),
      height: thick,
      borderRadius: thick / 2,
      top: middle - thick / 2,
    };
  });

  if (gone) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="launch-curtain"
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.ground, groundStyle]} />
      <Animated.View style={[styles.hanger, { left, top, transformOrigin: PIVOT }, hangerStyle]}>
        <Image
          testID="launch-picture"
          source={SPLASH}
          style={styles.picture}
          onLoad={onShown}
          onError={onShown}
        />
      </Animated.View>
      {slow && !ready && (
        <Animated.View
          entering={FadeIn.duration(durations.state)}
          style={[styles.waiting, { top: top + SIZE + 24 }]}
        >
          <RailLine waiting />
        </Animated.View>
      )}
      <Animated.View style={[styles.bar, barStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  ground: {
    backgroundColor: colors.ground,
  },
  hanger: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
  },
  picture: {
    width: SIZE,
    height: SIZE,
  },
  waiting: {
    position: 'absolute',
    start: 64,
    end: 64,
  },
  bar: {
    position: 'absolute',
    backgroundColor: colors.text,
  },
});
