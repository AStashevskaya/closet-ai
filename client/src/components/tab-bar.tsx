import { Tabs, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { colors, fonts } from '@/theme';

// What expo-router's Tabs hands a custom bar (its vendored react-navigation isn't a dependency of ours).
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

// Where the thread runs across the bar, how far it sags under the current tab, and the bar's height.
const THREAD_Y = 22;
const SAG = 28;
const BAR_HEIGHT = 64;
// How far the sag reaches past an average word on each side, and the straight run before it curves.
const SAG_MARGIN = 10;
const SAG_RUN = 30;
// On the way to another tab the sag stretches this much deeper, then settles back with a little bounce.
const SAG_DIP = 0.22;
// The sag's slide: a spring a touch under critical damping, so it eases off and lands like a weight.
const SLIDE_SPRING = { damping: 20, stiffness: 140 };
const SETTLE_SPRING = { damping: 9, stiffness: 110 };

// The bar's bottom padding: the home indicator or Android's buttons, or a little room without them.
const bottomPadding = (inset: number) => Math.max(inset, 12);

// How much room tab screens leave at the bottom so their last row clears the bar, with some air.
// A hook because the bar grows with the bottom inset (Android's three-button navigation is tall).
export function useTabBarClearance() {
  const insets = useSafeAreaInsets();
  return BAR_HEIGHT + bottomPadding(insets.bottom) + 24;
}

type Spot = { x: number; width: number };

// The thread drawn once, twice the bar's width with the sag in the middle: moving it sideways moves
// the sag, and stretching it down from the thread's line deepens the sag. Only transform changes per
// frame, so the slide runs on the UI thread without redrawing the path.
function threadPath(width: number, half: number) {
  const y = THREAD_Y;
  const low = y + SAG;
  const c = width;
  return (
    `M0 ${y}L${c - half - SAG_RUN} ${y}` +
    `C${c - half} ${y} ${c - half} ${low} ${c} ${low}` +
    `C${c + half} ${low} ${c + half} ${y} ${c + half + SAG_RUN} ${y}L${width * 2} ${y}`
  );
}

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
  const stretch = useSharedValue(1);

  // One sag width for all tabs, from the words' average, so the path never has to change while moving.
  const words = Object.values(spots);
  const half = words.length
    ? Math.max(26, words.reduce((sum, w) => sum + w.width, 0) / words.length / 2 + SAG_MARGIN)
    : 0;

  // The tab the sag last went to: it slides only to another tab, and a word that only changed size
  // (a new font scale or language) has it follow at once.
  const placedFor = useRef(-1);
  const moveTo = (index: number) => {
    const spot = spots[index];
    if (!spot) return;
    const target = spot.x + spot.width / 2;
    const sameTab = placedFor.current === index;
    placedFor.current = index;
    // The first placement, every move with reduced motion and a resize of the same word are immediate.
    if (center.value < 0 || reduceMotion || sameTab) {
      center.value = target;
      return;
    }
    center.value = withSpring(target, SLIDE_SPRING);
    stretch.value = withSequence(
      withTiming(1 + SAG_DIP, { duration: 220, easing: Easing.out(Easing.quad) }),
      withSpring(1, SETTLE_SPRING),
    );
  };

  // Also when the tab changes from elsewhere (a link, the back button) and once the words are laid out.
  const spot = spots[state.index];
  useEffect(() => {
    moveTo(state.index);
    // moveTo reads the latest spots through `spot`; listing it would rerun on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot, state.index, reduceMotion]);

  const mover = useAnimatedStyle(() => ({
    opacity: center.value < 0 ? 0 : 1,
    transform: [{ translateX: center.value - width }, { scaleY: stretch.value }],
  }));

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
          if (focused || event.defaultPrevented) return;
          // The sag starts at the touch, not after the next screen has rendered.
          moveTo(index);
          navigateToTab(route.key);
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
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.thread}>
        {width > 0 && half > 0 && (
          <Animated.View style={[styles.mover, { width: width * 2 }, mover]}>
            <Svg width={width * 2} height={BAR_HEIGHT}>
              <Path
                d={threadPath(width, half)}
                fill="none"
                stroke={colors.text}
                strokeWidth={1.2}
                strokeLinecap="round"
              />
            </Svg>
          </Animated.View>
        )}
      </View>
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
  // Laid out left to right in every language: the thread is placed by physical x.
  thread: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    direction: 'ltr',
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  // Stretched down from the thread's own line, so only the sag deepens.
  mover: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: BAR_HEIGHT,
    transformOrigin: ['50%', THREAD_Y, 0],
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
