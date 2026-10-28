import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, Keyframe } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

export type SelectOption<T> = { value: T; label: string };

type Props<T> = {
  // What is being chosen ("Language"), on the row and over the list.
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

// The sheet answers a tap, so it comes up quicker than blocks that appear on their own.
const sheetIn = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 32 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
}).duration(durations.leave);

// A row with the current choice; a tap opens the options as a sheet from the bottom. Rows and
// the check sit at start and end, so the layout mirrors itself in right-to-left languages.
export function Select<T>({ label, value, options, onChange, disabled }: Props<T>) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const current = options.find((option) => option.value === value)?.label ?? '';

  function pick(next: T) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  return (
    <>
      <Pressable
        style={[styles.row, disabled && styles.dim]}
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
      >
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={1}>
          {current}
        </Text>
        <View style={styles.down}>
          <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
        </View>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <Animated.View entering={FadeIn.duration(durations.state)} style={StyleSheet.absoluteFill}>
          <View style={styles.tint} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={label}
          />
        </Animated.View>
        <Animated.View
          entering={sheetIn}
          style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}
        >
          <Text style={styles.title} accessibilityRole="header">
            {label}
          </Text>
          <View accessibilityRole="radiogroup">
            {options.map((option) => (
              <Pressable
                key={String(option.value)}
                style={styles.option}
                onPress={() => pick(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: option.value === value }}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
                {option.value === value && <Icon name="check" color={colors.text} size={18} />}
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </Modal>
    </>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  dim: {
    opacity: 0.5,
  },
  label: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  value: {
    flexShrink: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
  // The chevron points down, the same way in both directions.
  down: {
    transform: [{ rotate: '90deg' }],
  },
  // The thread colour, thinned: the screen behind stays readable. Apart from the fade, which
  // animates its own view's opacity up to 1.
  tint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.text,
    opacity: 0.28,
  },
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    backgroundColor: colors.background,
  },
  title: {
    marginBottom: 8,
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  optionLabel: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
});
