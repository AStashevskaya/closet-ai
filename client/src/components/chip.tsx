import type { ItemColor } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

// What each palette color looks like as a small dot next to its name.
// Tuned 2026-11-12 (owner chose the juicier set): saturated like dyed fabrics, not screen primaries.
export const SWATCHES: Record<Exclude<ItemColor, 'multicolor'>, string> = {
  black: '#141414',
  white: '#FFFFFF',
  cream: '#F6E7C8',
  gray: '#9B9B9B',
  beige: '#E2C69B',
  camel: '#C4893F',
  brown: '#7B4423',
  red: '#DA2A2A',
  burgundy: '#8C1232',
  pink: '#F493B3',
  orange: '#F2741F',
  yellow: '#F7C821',
  khaki: '#8F8B35',
  green: '#24914F',
  light_blue: '#7FBDF2',
  blue: '#1F62D1',
  navy: '#16245A',
  purple: '#7D35B0',
  gold: '#D9A520',
  silver: '#C4CBD3',
};
export const MULTICOLOR = ['#DA2A2A', '#F7C821', '#1F62D1'];

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  // Shows a color dot before the label.
  color?: ItemColor;
};

export function Chip({ label, selected, onPress, color }: Props) {
  return (
    <PressableScale
      style={[styles.chip, selected && styles.selected]}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      {color === 'multicolor' ? (
        <View style={[styles.dot, styles.multicolor]}>
          {MULTICOLOR.map((c) => (
            <View key={c} style={[styles.stripe, { backgroundColor: c }]} />
          ))}
        </View>
      ) : color ? (
        <View style={[styles.dot, { backgroundColor: SWATCHES[color] }]} />
      ) : null}
      <Animated.Text
        style={[
          styles.label,
          selected && styles.labelSelected,
          {
            transitionProperty: 'color',
            transitionDuration: durations.press,
            transitionTimingFunction: CSS_EASE_OUT,
          },
        ]}
      >
        {label}
      </Animated.Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // The cherry bead, as on The Edit's filters.
  selected: {
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  multicolor: {
    flexDirection: 'row',
  },
  stripe: {
    flex: 1,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.onBead,
  },
});
