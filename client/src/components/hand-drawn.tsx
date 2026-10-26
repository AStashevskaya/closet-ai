import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
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

type Segment = [Point, Point, Point, Point];

// A smooth line through the points (Catmull-Rom), as cubic Béziers: start, two controls, end.
function segments(points: Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    out.push([
      p1,
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    ]);
  }
  return out;
}

export function smoothPath(points: Point[]): string {
  const f = (n: number) => n.toFixed(1);
  const parts = segments(points).map(
    ([, c1, c2, end]) =>
      `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(end[0])} ${f(end[1])}`,
  );
  return `M${f(points[0]![0])} ${f(points[0]![1])}${parts.join('')}`;
}

// The line's length, measured along the curve itself (each Bézier sampled finely), with a hair of
// margin. Used as the dash, so the line can be drawn in by sliding the dash along it.
export function lineLength(points: Point[]): number {
  const at = ([a, b, c, d]: Segment, t: number): Point => {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
    return [
      k[0] * a[0] + k[1] * b[0] + k[2] * c[0] + k[3] * d[0],
      k[0] * a[1] + k[1] * b[1] + k[2] * c[1] + k[3] * d[1],
    ];
  };
  let length = 0;
  for (const segment of segments(points)) {
    let last = segment[0];
    for (let i = 1; i <= 12; i++) {
      const next = at(segment, i / 12);
      length += Math.hypot(next[0] - last[0], next[1] - last[1]);
      last = next;
    }
  }
  return Math.ceil(length) + 2;
}

// A stable number from an id, so each look's shape is its own and stays the same.
export function seedFrom(id: string): number {
  let seed = 0;
  for (const char of id) seed = (seed * 31 + char.charCodeAt(0)) % 9973;
  return seed + 1;
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
// Drawn in only when `drawn` turns true while on screen; one already true when it appears (a look liked
// before) is simply there, so "liked earlier" doesn't look like "just liked".
// Nothing is mounted until it's first drawn, so a list of looks costs nothing for the unliked ones.
// Decoration only (what it means is told by the control that caused it), so screen readers skip it.
export function HandDrawn(props: Props) {
  // Whether it was already drawn when it appeared; and whether it has been drawn at all yet.
  const [appearedDrawn] = useState(props.drawn);
  const [ever, setEver] = useState(props.drawn);
  // Derived during render rather than in an effect: React re-renders at once with the new value.
  if (props.drawn && !ever) setEver(true);
  return ever ? <Shape {...props} appearedDrawn={appearedDrawn} /> : null;
}

function Shape({
  shape,
  drawn,
  seed,
  fill = false,
  delay = 0,
  style,
  appearedDrawn,
}: Props & { appearedDrawn: boolean }) {
  const reduceMotion = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  const geometry = useMemo(() => {
    if (!box) return null;
    const points = (shape === 'heart' ? heartPoints : loopPoints)(
      box.w - PAD * 2,
      box.h - PAD * 2,
      seed,
    );
    return { d: smoothPath(points), length: lineLength(points) };
  }, [box, shape, seed]);
  const length = geometry?.length ?? 0;

  // How much of the line is drawn (0…1), how visible the whole shape is, and the fill after the line.
  // A shape that was already drawn when it first appeared starts complete.
  const startedDrawn = appearedDrawn;
  const progress = useSharedValue(startedDrawn ? 1 : 0);
  const opacity = useSharedValue(startedDrawn ? 1 : 0);
  const filled = useSharedValue(startedDrawn ? 1 : 0);
  const first = useRef(true);

  useEffect(() => {
    // Nothing to draw until the box is measured; the first run only settles what's already there.
    if (!length) return;
    if (first.current) {
      first.current = false;
      if (startedDrawn) return;
    }
    cancelAnimation(progress);
    cancelAnimation(opacity);
    cancelAnimation(filled);
    if (reduceMotion) {
      progress.value = drawn ? 1 : 0;
      opacity.value = drawn ? 1 : 0;
      filled.value = drawn ? 1 : 0;
      return;
    }
    if (drawn) {
      // Drawn in from nothing: the line slides along its dash, then the inside fills.
      progress.value = 0;
      filled.value = 0;
      opacity.value = 1;
      progress.value = withDelay(delay, withTiming(1, { duration: DRAW, easing: EASE_OUT }));
      filled.value = withDelay(
        delay + DRAW * 0.8,
        withTiming(1, { duration: durations.settle, easing: EASE_OUT }),
      );
    } else {
      // Taken away quietly: the whole shape fades rather than undrawing.
      opacity.value = withTiming(0, { duration: durations.leave });
    }
  }, [drawn, length, delay, reduceMotion, startedDrawn, progress, opacity, filled]);

  const line = useAnimatedProps(
    () => ({
      strokeDashoffset: length * (1 - progress.value),
      // Hidden outright at the very start, or the round cap would leave a dot.
      strokeOpacity: progress.value > 0 ? opacity.value : 0,
      fillOpacity: opacity.value * filled.value,
    }),
    [length],
  );

  return (
    <View
      style={[styles.fill, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((old) =>
          old && old.w === width && old.h === height ? old : { w: width, h: height },
        );
      }}
    >
      {box && geometry && (
        <Svg width={box.w} height={box.h}>
          <AnimatedPath
            d={geometry.d}
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
    pointerEvents: 'none',
  },
});
