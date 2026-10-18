import { useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { CSS_EASE_OUT, durations } from '@/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> };

// A Pressable that shrinks slightly under the finger, so a tap feels physical.
// The feedback starts on press-in; the action still fires on release.
// With reduced motion it dims instead of shrinking. Background and border colors ease too,
// so a pressable that changes state (a selected chip) tints instead of snapping.
export function PressableScale({ style, onPressIn, onPressOut, ...rest }: Props) {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          transform: [{ scale: pressed && !reduced ? 0.97 : 1 }],
          opacity: pressed && reduced ? 0.7 : 1,
          transitionProperty: ['transform', 'opacity', 'backgroundColor', 'borderColor'],
          transitionDuration: durations.press,
          transitionTimingFunction: CSS_EASE_OUT,
        },
      ]}
    />
  );
}
