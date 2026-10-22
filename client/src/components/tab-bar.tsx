import { BlurView } from 'expo-blur';
import { Tabs, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { colors } from '@/theme';

// What expo-router's Tabs hands a custom bar (its vendored react-navigation isn't a dependency of ours).
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

// How much room screens leave at the bottom so their last row clears the floating bar.
export const TAB_BAR_CLEARANCE = 104;

const ICONS: Record<string, IconName> = {
  index: 'hanger',
  style: 'spark',
  inspiration: 'heart',
  profile: 'user',
};

// A frosted capsule floating over the content, with thin icons and no labels (as on Loewe's
// site), and "+" in the middle to add an item. Screen readers get each tab's title.
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const tab = (index: number) => {
    const route = state.routes[index]!;
    const focused = state.index === index;
    const { options } = descriptors[route.key]!;
    return (
      <PressableScale
        key={route.key}
        style={styles.tab}
        hitSlop={6}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.title}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
      >
        <Icon
          name={ICONS[route.name] ?? 'home'}
          color={focused ? colors.text : colors.tabInactive}
          size={21}
          strokeWidth={focused ? 1.5 : 1.15}
        />
        <View style={[styles.dot, focused && styles.dotOn]} />
      </PressableScale>
    );
  };

  const half = Math.ceil(state.routes.length / 2);
  return (
    <View
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 6 }]}
      pointerEvents="box-none"
    >
      <BlurView
        intensity={80}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        style={styles.capsule}
      >
        {state.routes.slice(0, half).map((_, i) => tab(i))}
        <PressableScale
          style={styles.plus}
          onPress={() => router.push('/add-item')}
          accessibilityRole="button"
          accessibilityLabel={t('closet.add')}
        >
          <Icon name="plus" color={colors.text} size={20} strokeWidth={1.5} />
        </PressableScale>
        {state.routes.slice(half).map((_, i) => tab(half + i))}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 32,
    overflow: 'hidden',
    // Just milky enough for the icons to read; what scrolls under it shows through, blurred.
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.06)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)',
  },
  tab: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  dotOn: {
    backgroundColor: colors.text,
  },
  plus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.highlight,
  },
});
