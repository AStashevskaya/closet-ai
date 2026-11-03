import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { CSS_EASE_OUT, durations } from '@/motion';

// Faint enough to read as set aside, still clear enough to recognise the look. Only for pictures:
// text under this would fall below 4.5:1, so text goes to a quieter theme colour instead.
export const DIMMED_OPACITY = 0.45;

type Props = {
  dimmed: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: ReactNode;
};

// Pictures set aside: they fade on the UI thread (a CSS transition, nothing re-renders per frame);
// with reduced motion they change at once. The compositing flag is for Android, which otherwise
// applies the opacity to each child on its own, so a string would show through the piece it holds.
export function Dimmable({ dimmed, style, testID, children }: Props) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      testID={testID}
      needsOffscreenAlphaCompositing
      style={[
        style,
        {
          opacity: dimmed ? DIMMED_OPACITY : 1,
          transitionProperty: 'opacity',
          transitionDuration: reduceMotion ? 0 : durations.state,
          transitionTimingFunction: CSS_EASE_OUT,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
