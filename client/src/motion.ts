import { cubicBezier, Easing } from 'react-native-reanimated';

// Strong ease-out: motion starts at once and settles softly, so UI never feels like it lags the finger.
// CSS transitions take `cubicBezier`, layout animations and withTiming take `Easing.bezier`.
export const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export const durations = {
  press: 120,
  state: 160,
  leave: 220,
  enter: 320,
} as const;
