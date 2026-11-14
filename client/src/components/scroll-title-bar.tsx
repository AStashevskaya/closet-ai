import { BlurView } from 'expo-blur';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '@/theme';

// How far the big title has scrolled when the bar starts to come in, and when it's fully there.
const FROM = 60;
const TO = 120;

// The screen's scroll position, for `ScrollTitleBar`: pass `onScroll` to an Animated.ScrollView.
export function useScrollTitle() {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  return { scrollY, onScroll };
}

type Props = {
  title: string;
  scrollY: ReturnType<typeof useScrollTitle>['scrollY'];
};

// A tab screen without a header: the big title scrolls away and a frosted bar with the small one
// comes in, so nothing that scrolls (a thread, text) runs under the clock. Put it after the
// scroll view, inside a view that fills the screen. Decoration only: the big title above is the
// heading screen readers get.
export function ScrollTitleBar({ title, scrollY }: Props) {
  const insets = useSafeAreaInsets();
  const bar = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [FROM, TO], [0, 1], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View
      style={[styles.bar, { height: insets.top + 48 }, bar]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <BlurView
        intensity={70}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        style={[StyleSheet.absoluteFill, styles.glass]}
      />
      <View style={[styles.row, { paddingTop: insets.top }]}>
        <Text style={styles.title}>{title}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
  },
  glass: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.06)',
  },
  row: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
  },
});
