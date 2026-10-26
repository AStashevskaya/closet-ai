import { Tabs, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
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

// Where the thread runs across the bar, how far it sags under the current tab, and the bar's height.
const THREAD_Y = 22;
const SAG = 28;
const BAR_HEIGHT = 64;
// How far the sag reaches past the word on each side, and the straight run before it curves down.
const SAG_MARGIN = 10;
const SAG_RUN = 30;
// How much deeper the sag dips halfway through a slide.
const SAG_DIP = 6;
// The sag sliding to another tab: long enough to read as weight moving along a line.
const SLIDE = 600;

// The bar's bottom padding: the home indicator or Android's buttons, or a little room without them.
const bottomPadding = (inset: number) => Math.max(inset, 12);

// How much room tab screens leave at the bottom so their last row clears the bar, with some air.
// A hook because the bar grows with the bottom inset (Android's three-button navigation is tall).
export function useTabBarClearance() {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + bottomPadding(insets.bottom) + 24;
}

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
  // Where each tab's word sits, by route index, from layout (physical x, so RTL needs nothing more).
  const [spots, setSpots] = useState<Record<number, Spot>>({});

  // The bar's width, as a shared value so the worklet below sees it change (first layout, rotation).
  const width = useSharedValue(0);
  const center = useSharedValue(-1);
  const half = useSharedValue(0);
  // 0 → 1 while sliding: the sag dips a little deeper on the way, like weight settling.
  const travel = useSharedValue(1);

  const spot = spots[state.index];
  // The tab the sag last went to: it slides only to another tab, and a word that only changed size
  // (a new font scale or language) has it follow at once.
  const placedFor = useRef(-1);
  useEffect(() => {
    if (!spot) return;
    const target = spot.x + spot.width / 2;
    const targetHalf = spot.width / 2 + SAG_MARGIN;
    const sameTab = placedFor.current === state.index;
    placedFor.current = state.index;
    // The first placement, every move with reduced motion and a resize of the same word are immediate.
    if (center.value < 0 || reduceMotion || sameTab) {
      center.value = target;
      half.value = targetHalf;
      return;
    }
    const timing = { duration: SLIDE, easing: EASE_OUT };
    center.value = withTiming(target, timing);
    half.value = withTiming(targetHalf, timing);
    travel.value = 0;
    travel.value = withTiming(1, timing);
  }, [spot, state.index, reduceMotion, center, half, travel]);

  const thread = useAnimatedProps(() => {
    const y = THREAD_Y;
    const w = width.value;
    if (center.value < 0) return { d: `M0 ${y}L${w} ${y}` };
    const c = center.value;
    const h = half.value;
    const low = y + SAG + Math.sin(travel.value * Math.PI) * SAG_DIP;
    return {
      d:
        `M0 ${y}L${c - h - SAG_RUN} ${y}` +
        `C${c - h} ${y} ${c - h} ${low} ${c} ${low}` +
        `C${c + h} ${low} ${c + h} ${y} ${c + h + SAG_RUN} ${y}L${w} ${y}`,
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
      style={[styles.bar, { paddingBottom: bottomPadding(insets.bottom) }]}
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
      }}
    >
      <Svg width="100%" height={BAR_HEIGHT} style={styles.thread}>
        <AnimatedPath
          animatedProps={thread}
          fill="none"
          stroke={colors.text}
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      </Svg>
      <View style={styles.row} accessibilityRole="tablist">
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
  thread: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'none',
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
