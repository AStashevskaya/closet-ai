import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { durations, EASE_OUT } from '@/motion';
import { colors } from '@/theme';

// "The Thread" (2026-10-26): shapes drawn by hand with the thread, never ruled. A heart only where
// the meaning is love (a liked outfit, a saved look, the chosen piece); a plain loop elsewhere.
// Prototype: ~/Desktop/closet/wrinkle-lab/design-shell.

type Point = [number, number];
export type HandShape = 'heart' | 'loop';

// A repeatable wobble: the same seed always draws the same shape, so a heart doesn't change on re-render.
function wobble(seed: number) {
  return (k: number) => {
    const x = Math.sin(seed * 71.7 + k * 9.3) * 43758.5;
    return x - Math.floor(x);
  };
}

// The classic heart curve, a little wobbly, starting just before the dip on top and running past it,
// so the thread crosses there like a knot. Fills a w × h box.
export function heartPoints(w: number, h: number, seed: number): Point[] {
  const rnd = wobble(seed);
  const points: Point[] = [];
  const steps = 28;
  const overshoot = 0.45;
  for (let i = 0; i <= steps; i++) {
    const t = -0.12 + (i / steps) * (Math.PI * 2 + overshoot);
    const k = 1 + (rnd(i) - 0.5) * 0.06;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    // The curve spans x −16…16 and y −17…12; scaled into the box, with the wobble.
    points.push([w / 2 + (x / 17) * (w / 2) * k, h / 2 - ((y + 2.5) / 15) * (h / 2) * k]);
  }
  return points;
}

// A wobbly ellipse that runs a little past where it started and drifts outward on the way, so the
// ends cross instead of meeting.
export function loopPoints(w: number, h: number, seed: number): Point[] {
  const rnd = wobble(seed);
  const points: Point[] = [];
  const steps = 14;
  const start = -2.2 + rnd(1) * 0.4;
  for (let i = 0; i <= steps + 3; i++) {
    const a = start + (i / steps) * Math.PI * 2;
    const k = 1 + (rnd(i + 2) - 0.5) * 0.09 + (i > steps ? 0.05 * (i - steps) : 0);
    points.push([
      w / 2 + Math.cos(a) * (w / 2) * 0.94 * k,
      h / 2 + Math.sin(a) * (h / 2) * 0.94 * k,
    ]);
  }
  return points;
}

// A smooth line through the points (Catmull-Rom, as cubic Béziers).
export function smoothPath(points: Point[]): string {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(points[0]![0])} ${f(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d +=
      `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

// The line's length, from the points it runs through: the curve is a touch longer, hence the margin.
// Used as the dash, so the line can be drawn in by sliding the dash along it.
export function lineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return Math.ceil(length * 1.08);
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

// How long the line takes to draw itself (the owner's pick, 2026-10-26); the fill comes in near its end.
const DRAW = 1000;

// The stroke is inset by this much so it isn't clipped at the box's edges.
const PAD = 3;

type Props = {
  shape: HandShape;
  // Whether it's there: drawing it in when it turns true, fading it out when it turns false.
  drawn: boolean;
  // Any number; the same one draws the same shape.
  seed: number;
  // Soft colour inside (a heart's fill); none for a plain line.
  fill?: boolean;
  delay?: number;
  style?: StyleProp<ViewStyle>;
};

// A shape drawn by hand with the thread: the line draws itself in, then the inside fills softly.
// Decoration only (what it means is told by the control that caused it), so screen readers skip it.
export function HandDrawn({ shape, drawn, seed, fill = false, delay = 0, style }: Props) {
  const reduceMotion = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  const w = box ? box.w - PAD * 2 : 0;
  const h = box ? box.h - PAD * 2 : 0;
  const points = box ? (shape === 'heart' ? heartPoints : loopPoints)(w, h, seed) : [];
  const length = box ? lineLength(points) : 0;

  // How much of the line is drawn (0…1), how visible the whole shape is, and the fill after the line.
  // Shared values only, so the worklet below always sees the latest ones.
  const shown = drawn && reduceMotion ? 1 : 0;
  const progress = useSharedValue(shown);
  const opacity = useSharedValue(shown);
  const filled = useSharedValue(shown);
  const dash = useSharedValue(length);

  useEffect(() => {
    dash.value = length;
  }, [length, dash]);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = drawn ? 1 : 0;
      opacity.value = drawn ? 1 : 0;
      filled.value = drawn ? 1 : 0;
      return;
    }
    const draw = { duration: DRAW, easing: EASE_OUT };
    const fillIn = { duration: durations.settle, easing: EASE_OUT };
    if (drawn) {
      // Drawn in from nothing: the line slides along its dash, then the inside fills.
      progress.value = 0;
      filled.value = 0;
      opacity.value = 1;
      progress.value = withDelay(delay, withTiming(1, draw));
      filled.value = withDelay(delay + DRAW * 0.8, withTiming(1, fillIn));
    } else {
      // Taken away quietly: the whole shape fades rather than undrawing.
      opacity.value = withTiming(0, { duration: durations.leave });
    }
  }, [drawn, delay, reduceMotion, progress, opacity, filled]);

  const line = useAnimatedProps(() => ({
    strokeDashoffset: dash.value * (1 - progress.value),
    strokeOpacity: opacity.value,
    fillOpacity: opacity.value * filled.value,
  }));

  return (
    <View
      style={[styles.fill, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((old) =>
          old && old.w === width && old.h === height ? old : { w: width, h: height },
        );
      }}
    >
      {box && (
        <Svg width={box.w} height={box.h}>
          <AnimatedPath
            d={smoothPath(points)}
            transform={`translate(${PAD} ${PAD})`}
            animatedProps={line}
            fill={fill ? colors.ground : 'none'}
            stroke={colors.text}
            strokeWidth={1.3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={[length, length]}
          />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Fills its parent unless the caller places it (start / end, so a caller's edges win in RTL too).
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
  },
});
