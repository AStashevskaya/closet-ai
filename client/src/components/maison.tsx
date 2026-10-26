import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { colors, fonts } from '@/theme';

// The building blocks every screen of the "Maison" look shares, so titles, buttons and section
// labels look the same everywhere.

// The big light serif title at the top of a screen, with an optional line under it.
export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// A small label over a section, with an optional action at its end.
export function SectionLabel({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section} accessibilityRole="header">
        {children}
      </Text>
      {action}
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  // ink: the main action; outline: a second one next to it; bright: on an ink or photo ground.
  kind?: 'ink' | 'outline' | 'bright';
  style?: StyleProp<ViewStyle>;
};

// A full-width pill button.
export function Button({ label, onPress, disabled, busy, kind = 'ink', style }: ButtonProps) {
  return (
    <PressableScale
      style={[
        styles.button,
        styles[kind],
        busy && styles.dim,
        // Off reads as off: half-transparent ink still looked like a button to tap (2026-10-25).
        disabled && !busy && (kind === 'bright' ? styles.dim : styles.off),
        style,
      ]}
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'outline' ? colors.text : colors.onAccent} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            kind !== 'outline' && styles.buttonTextInk,
            disabled && kind !== 'bright' && styles.buttonTextOff,
          ]}
        >
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
export const maison = StyleSheet.create({
  // Screen sides: the same gutter everywhere.
  gutter: {
    paddingHorizontal: 20,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'left',
  },
  link: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
});

const styles = StyleSheet.create({
  titleBlock: {
    gap: 6,
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 48,
    lineHeight: 50,
    color: colors.text,
    textAlign: 'left',
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  section: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
    textAlign: 'left',
  },
  button: {
    minHeight: 52,
    paddingHorizontal: 24,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ink: {
    backgroundColor: colors.accent,
  },
  outline: {
    borderWidth: 1,
    borderColor: colors.text,
  },
  bright: {
    backgroundColor: colors.bead,
  },
  dim: {
    opacity: 0.5,
  },
  off: {
    backgroundColor: colors.hero,
    borderColor: colors.border,
  },
  buttonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
  buttonTextInk: {
    color: colors.onAccent,
  },
  // 4.8:1 on the studio grey.
  buttonTextOff: {
    color: colors.textMuted,
  },
});
