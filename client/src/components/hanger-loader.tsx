import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/theme';

type Props = {
  // 'small' sits next to a status line, 'large' fills a screen that is waiting.
  size?: 'small' | 'large';
};

const WIDTH = { small: 28, large: 72 } as const;
// One swing from side to side, slow like everything else that moves on its own.
const SWING_MS = 1100;
const SWING_DEG = 9;

// The app's loader: a hanger swinging on its hook with a bright tag swinging a beat behind,
// drawn as vectors (sharp at any size, nothing to download) in place of the system spinner.
export function HangerLoader({ size = 'large' }: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const swing = useSharedValue(0);
  const tag = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    const ease = { duration: SWING_MS, easing: Easing.inOut(Easing.sin) };
    swing.set(withRepeat(withTiming(1, ease), -1, true));
    tag.set(withDelay(SWING_MS / 4, withRepeat(withTiming(1, ease), -1, true)));
  }, [reduced, swing, tag]);

  const hanger = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(swing.get() * 2 - 1) * SWING_DEG}deg` }],
  }));
  const tagSwing = useAnimatedStyle(() => ({
    transform: [{ rotate: `${(tag.get() * 2 - 1) * SWING_DEG * 1.6}deg` }],
  }));

  const width = WIDTH[size];
  const height = width * (40 / 48);
  const stroke = size === 'small' ? 2.4 : 1.6;
  return (
    <View
      style={{ width, height }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
    >
      {/* Rotates around the top of the hook. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.pivot, hanger]}>
        <Svg width={width} height={height} viewBox="0 0 48 40">
          <Path
            d="M20.6 6.2a3.6 3.6 0 1 1 3.4 4.2V14L4.6 28.2c-1.6 1.2-.8 3 1 3h36.8c1.8 0 2.6-1.8 1-3L24 14"
            fill="none"
            stroke={colors.text}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        {/* The tag hangs off the bar and lags the hanger a little. */}
        <Animated.View style={[styles.tag, { width, height }, tagSwing]}>
          <Svg width={width} height={height} viewBox="0 0 48 40">
            <Path d="M33 31.2v2.6" stroke={colors.text} strokeWidth={stroke * 0.6} />
            <Rect x={30.2} y={33.6} width={5.6} height={6} rx={1} fill={colors.highlight} />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pivot: {
    transformOrigin: '50% 2%',
  },
  tag: {
    position: 'absolute',
    top: 0,
    start: 0,
    // Its string's top on the bar.
    transformOrigin: '68.75% 78%',
  },
});
