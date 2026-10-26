import { Tabs, useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

// What expo-router's Tabs hands a custom bar (its vendored react-navigation isn't a dependency of ours).
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

// How much room screens leave at the bottom so their last row clears the bar.
export const TAB_BAR_CLEARANCE = 104;

// Where the thread runs across the bar, how far it sags under the current tab, and the bar's height.
const THREAD_Y = 22;
const SAG = 28;
const BAR_HEIGHT = 64;
// The sag sliding to another tab: long enough to read as weight moving along a line.
const SLIDE = 600;

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Spot = { x: number; width: number };

// "The Thread" (2026-10-26): the bar is the same ink line as the closet rails, with the tabs as words
// on it. Under the current one the thread sags as if the word hung there, and the sag slides to the
// next tab; "+" is a bright bead knotted into the thread, opening the add-item form.
export function TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  // Where each tab's word sits, by route index, from layout (physical x, so RTL needs nothing more).
  const [spots, setSpots] = useState<Record<number, Spot>>({});

  const center = useSharedValue(-1);
  const half = useSharedValue(0);
  // 0 → 1 while sliding: the sag dips a little deeper on the way, like weight settling.
  const travel = useSharedValue(1);

  const spot = spots[state.index];
  useEffect(() => {
    if (!spot) return;
    const target = spot.x + spot.width / 2;
    const targetHalf = spot.width / 2 + 10;
    // The first placement, and every move with reduced motion, is immediate.
    if (center.value < 0 || reduceMotion) {
      center.value = target;
      half.value = targetHalf;
      return;
    }
    const timing = { duration: SLIDE, easing: EASE_OUT };
    center.value = withTiming(target, timing);
    half.value = withTiming(targetHalf, timing);
    travel.value = 0;
    travel.value = withTiming(1, timing);
  }, [spot, reduceMotion, center, half, travel]);

  const thread = useAnimatedProps(() => {
    const y = THREAD_Y;
    if (center.value < 0) return { d: `M0 ${y}L${width} ${y}` };
    const c = center.value;
    const h = half.value;
    const low = y + SAG + Math.sin(travel.value * Math.PI) * 6;
    return {
      d:
        `M0 ${y}L${c - h - 30} ${y}` +
        `C${c - h} ${y} ${c - h} ${low} ${c} ${low}` +
        `C${c + h} ${low} ${c + h} ${y} ${c + h + 30} ${y}L${width} ${y}`,
    };
  });

  const place = (index: number) => (event: LayoutChangeEvent) => {
    const { x, width: w } = event.nativeEvent.layout;
    setSpots((current) => {
      const old = current[index];
      return old && old.x === x && old.width === w ? current : { ...current, [index]: { x, width: w } };
    });
  };

  const tab = (index: number) => {
    const route = state.routes[index]!;
    const focused = state.index === index;
    const { options } = descriptors[route.key]!;
    return (
      <PressableScale
        key={route.key}
        style={styles.tab}
        onLayout={place(index)}
        hitSlop={4}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.title}
        onPress={() => {
          const event = emitter.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        }}
      >
        <Text
          style={[styles.word, focused && styles.wordOn]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {options.title}
        </Text>
      </PressableScale>
    );
  };

  const middle = Math.ceil(state.routes.length / 2);
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Svg
        width={width}
        height={BAR_HEIGHT}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <AnimatedPath
          animatedProps={thread}
          fill="none"
          stroke={colors.text}
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      </Svg>
      <View style={styles.row}>
        {state.routes.slice(0, middle).map((_, i) => tab(i))}
        <PressableScale
          style={styles.bead}
          onPress={() => router.push('/add-item')}
          accessibilityRole="button"
          accessibilityLabel={t('closet.add')}
        >
          <View style={styles.beadDot}>
            <Icon name="plus" color={colors.onBead} size={16} strokeWidth={1.6} />
          </View>
        </PressableScale>
        {state.routes.slice(middle).map((_, i) => tab(middle + i))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
  },
  row: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  // 44 pt tall from just above the thread, so the word sits in the sag under it.
  tab: {
    marginTop: THREAD_Y - 10,
    minWidth: 44,
    height: 44,
    paddingTop: 14,
    paddingHorizontal: 3,
    alignItems: 'center',
  },
  word: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
  },
  wordOn: {
    fontFamily: fonts.bodyMedium,
    color: colors.text,
  },
  // A 44 pt target centred on the thread, the bead itself smaller.
  bead: {
    marginTop: THREAD_Y - 22,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beadDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bead,
    borderWidth: 1.2,
    borderColor: colors.text,
  },
});
