import { cubicBezier, Easing } from 'react-native-reanimated';

// Strong ease-out: motion starts at once and settles softly, so UI never feels like it lags the finger.
// CSS transitions take `cubicBezier`, layout animations and withTiming take `Easing.bezier`.
export const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Touch feedback stays quick; everything that appears is deliberately slow, as on Dior's site.
export const durations = {
  press: 120,
  state: 240,
  leave: 360,
  enter: 900,
  // Screens and big pictures settling in.
  settle: 1400,
} as const;
