import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { deleteWearWith } from '@/lib/api';
import { ApiError, isOffline } from '@/lib/api-error';
import { colors, fonts } from '@/theme';

// Deleting a styling, after saying plainly what it does. A failure tells her and keeps the stop;
// a styling the server no longer has counts as deleted. Works while its looks are being composed:
// the server drops the answer, and the screen's polling stops as the stop goes.
export function useDeleteStyling(requestId: string, onDeleted: () => void) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await deleteWearWith(requestId);
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 404)) {
        if (__DEV__) console.warn('Deleting the styling failed', cause);
        setBusy(false);
        Alert.alert(isOffline(cause) ? t('common.offline') : t('styleIt.deleteFailed'));
        return;
      }
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    AccessibilityInfo.announceForAccessibility(t('styleIt.deleted'));
    onDeleted();
  }

  function confirm() {
    Alert.alert(t('styleIt.deleteTitle'), t('styleIt.deleteMessage'), [
      { text: t('closet.cancel'), style: 'cancel' },
      { text: t('closet.delete'), style: 'destructive', onPress: () => void remove() },
    ]);
  }

  return { confirm, busy };
}

type Props = {
  control: ReturnType<typeof useDeleteStyling>;
  // Told apart by screen readers when the screen lists many; unknown while looks are composed.
  name?: string;
  style?: StyleProp<ViewStyle>;
};

// In words on the stop rather than behind a long press, which isn't obvious for deleting (owner).
// Quiet, since every stop has one: the confirmation carries the weight.
export function DeleteStyling({ control, name, style }: Props) {
  const { t } = useTranslation();
  return (
    <Pressable
      style={[styles.button, style]}
      onPress={control.confirm}
      disabled={control.busy}
      accessibilityRole="button"
      accessibilityLabel={name ? t('styleIt.deleteNamed', { name }) : t('styleIt.delete')}
      accessibilityState={{ disabled: control.busy, busy: control.busy }}
    >
      <Text style={[styles.text, control.busy && styles.busy]}>{t('styleIt.delete')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Tall enough to tap, as the item screen's delete; only as wide as its words.
  button: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  busy: {
    color: colors.textMuted,
  },
});
