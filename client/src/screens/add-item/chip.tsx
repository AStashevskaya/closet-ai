import type { ItemColor } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

// What each palette color looks like as a small dot next to its name.
const SWATCHES: Record<Exclude<ItemColor, 'multicolor'>, string> = {
  black: '#1F1A1B',
  white: '#FFFFFF',
  gray: '#9A9496',
  beige: '#E3D2B8',
  brown: '#7A5032',
  red: '#C62F2F',
  pink: '#EDA6B6',
  orange: '#E8833A',
  yellow: '#EFCB45',
  green: '#4F8A4B',
  blue: '#3C64B1',
  purple: '#7E4FA0',
};
const MULTICOLOR = ['#C62F2F', '#EFCB45', '#3C64B1'];

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
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
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
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  labelSelected: {
    color: colors.accent,
  },
});
