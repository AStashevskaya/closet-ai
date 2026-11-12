import { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
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

import { RAIL_WEIGHT, RailLine } from '@/components/rail-line';
import { isLaunching, launchDone, launchRail, onLaunchRail } from '@/lib/launch';
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
// No hanger is left waiting longer than this for the first rail to offer itself, or to answer.
const RAIL_WAIT_MS = 300;
// Past this, the bead runs along a rail under the hanger: the app is alive, just waiting.
const SLOW_MS = 900;
// The one swing while it loads: 180 + 220 + 180 + 180 ms.
const SWING_MS = 760;
// Android 12+ draws its own launch screen (the icon in a circle), so no copy can match it there:
// the curtain just fades, as with Reduce Motion.
const EXACT_COPY = Platform.OS === 'ios';

const ease = Easing.bezier(0.65, 0, 0.35, 1);

// The curtain over the app at launch ("Запуск", decided 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-launch`, direction B): an exact copy of the launch screen,
// so the system one can go unnoticed, whose hanger swings once while the app loads; when it's
// ready the hanger fades, its bottom bar stretches into a thread across the screen and settles on
// the first rail, and the blue melts away over the closet. With Reduce Motion it just fades.
// Decoration: screen readers skip it, and touches go through.
export function LaunchCurtain({ ready, onShown }: { ready: boolean; onShown: () => void }) {
  const reducedMotion = useReducedMotion();
  const plain = reducedMotion || !EXACT_COPY;
  const { width, height } = useWindowDimensions();
  const [swung, setSwung] = useState(plain);
  const [slow, setSlow] = useState(false);
  // Gone for good once the launch is over, even if this remounts.
  const [gone, setGone] = useState(() => !isLaunching());
  // The hand-off starts once, whatever happens to the window's size meanwhile.
  const started = useRef(false);

  const turn = useSharedValue(0);
  const picture = useSharedValue(1);
  const ground = useSharedValue(1);
  const bar = useSharedValue(0);
  const stretch = useSharedValue(0);
  const rise = useSharedValue(0);
  const from = useSharedValue(0);
  const target = useSharedValue(0);

  const left = (width - SIZE) / 2;
  const top = (height - SIZE) / 2;
  // Read when the hand-off starts, not depended on: a resize mid-way doesn't restart it.
  const size = useRef({ height, barMiddle: top + BAR.y });
  useEffect(() => {
    size.current = { height, barMiddle: top + BAR.y };
  }, [height, top]);

  // While the app loads: one swing, as a hanger nudged on a rail.
  useEffect(() => {
    if (plain || gone) return;
    turn.set(
      withSequence(
        withTiming(7, { duration: 180, easing: Easing.out(Easing.quad) }),
        withTiming(-4, { duration: 220 }),
        withTiming(2, { duration: 180 }),
        withTiming(0, { duration: 180 }),
      ),
    );
    // Its length in time, rather than its end callback, which an interrupted animation never calls.
    const timer = setTimeout(() => setSwung(true), SWING_MS);
    return () => clearTimeout(timer);
  }, [plain, gone, turn]);

  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (!ready || !swung || gone) return;
    const finish = () => {
      launchDone();
      setGone(true);
    };
    // Lands the bar on the rail at `railY`, or melts it with the blue when there's none on screen.
    const land = (railY: number | null) => {
      if (started.current) return;
      started.current = true;
      if (plain) {
        picture.set(withTiming(0, { duration: durations.state }));
        ground.set(withTiming(0, { duration: durations.state }));
        // By the clock rather than the animation's end callback, which an interrupted one never calls.
        setTimeout(finish, durations.state);
        return;
      }
      const { height: screen, barMiddle } = size.current;
      const lands = railY !== null && railY > 0 && railY < screen;
      from.set(barMiddle);
      target.set(lands ? railY : barMiddle);
      bar.set(1);
      picture.set(withTiming(0, { duration: 220 }));
      stretch.set(withTiming(1, { duration: 320, easing: ease }));
      rise.set(withDelay(320, withTiming(1, { duration: lands ? 380 : 0, easing: ease })));
      const melt = lands ? 700 : 420;
      ground.set(withDelay(melt, withTiming(0, { duration: 300 })));
      setTimeout(finish, melt + 300);
      // The thread goes as the blue does: the rail under it is drawn by then.
      bar.set(withDelay(lands ? 760 : 420, withTiming(0, { duration: 240 })));
    };
    // Measured now, when it lands: whatever came in above the rail meanwhile is counted.
    const measure = () => {
      const rail = launchRail();
      if (!rail || plain) return land(null);
      rail((y) => land(y));
      // A rail that never answers doesn't hold the curtain.
      setTimeout(() => land(null), RAIL_WAIT_MS);
    };
    if (launchRail()) {
      measure();
      return;
    }
    const off = onLaunchRail(measure);
    const timer = setTimeout(() => land(null), RAIL_WAIT_MS);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [ready, swung, gone, plain, picture, ground, bar, stretch, rise, from, target]);

  const hangerStyle = useAnimatedStyle(() => ({
    opacity: picture.get(),
    transform: [{ rotate: `${turn.get()}deg` }],
  }));
  const groundStyle = useAnimatedStyle(() => ({ opacity: ground.get() }));
  const barStyle = useAnimatedStyle(() => {
    const thick = interpolate(stretch.get(), [0, 1], [BAR.thick, RAIL_WEIGHT]);
    const middle = interpolate(rise.get(), [0, 1], [from.get(), target.get()]);
    return {
      opacity: bar.get(),
      left: interpolate(stretch.get(), [0, 1], [left + BAR.x, 0]),
      width: interpolate(stretch.get(), [0, 1], [BAR.width, width]),
      height: thick,
      borderRadius: thick / 2,
      top: middle - thick / 2,
    };
  });

  // The picture is decoded on load, but not on screen yet: the system launch screen goes two
  // frames later, so the copy is surely drawn under it by then.
  const shown = () => requestAnimationFrame(() => requestAnimationFrame(onShown));

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
          onLoad={shown}
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
