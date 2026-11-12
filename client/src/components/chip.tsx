import type { ItemColor } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

// What each palette color looks like as a small dot next to its name.
// Tuned 2026-11-12 to read as fabrics, not as screen primaries: muted, a little warm.
export const SWATCHES: Record<Exclude<ItemColor, 'multicolor'>, string> = {
  black: '#1C1A1B',
  white: '#FFFFFF',
  cream: '#F3EAD7',
  gray: '#A19C9A',
  beige: '#DCC9AC',
  camel: '#B98A55',
  brown: '#6B4630',
  red: '#C0302B',
  burgundy: '#6E1A2B',
  pink: '#E9A9B8',
  orange: '#E07B39',
  yellow: '#E9C75A',
  khaki: '#8A8358',
  green: '#3F6E4A',
  light_blue: '#A9C4E2',
  blue: '#2F5DA8',
  navy: '#1F2B4A',
  purple: '#6E4A8E',
  gold: '#C9A64B',
  silver: '#BFC3C7',
};
export const MULTICOLOR = ['#C0302B', '#E9C75A', '#2F5DA8'];

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
