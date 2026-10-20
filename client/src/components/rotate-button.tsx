import { useTranslation } from 'react-i18next';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { colors } from '@/theme';

type Props = {
  onPress: () => void;
  disabled?: boolean;
  // Where it sits on the photo.
  style?: StyleProp<ViewStyle>;
  size?: 'small' | 'regular';
};

// Round "turn a quarter clockwise" button laid over a photo before it is saved.
export function RotateButton({ onPress, disabled, style, size = 'regular' }: Props) {
  const { t } = useTranslation();
  const small = size === 'small';
  return (
    <PressableScale
      style={[styles.button, small && styles.small, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={small ? 10 : 4}
      accessibilityRole="button"
      accessibilityLabel={t('addItem.rotate')}
    >
      <Icon name="rotate" color={colors.text} size={small ? 14 : 18} strokeWidth={1.6} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    boxShadow: '0 1px 4px rgba(30, 26, 23, 0.18)',
  },
  small: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  disabled: {
    opacity: 0.5,
  },
});
