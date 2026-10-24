import { usePreventRemove } from 'expo-router/react-navigation';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

// Keeps a screen with unsaved work open: a swipe down on the modal sheet (easy to do by
// pulling a list past its top), the Android back button or a header button asks first.
// Returns `leave`, which runs a navigation of the screen's own (saved, or replaced by another
// screen on purpose) without asking.
export function useConfirmLeave(unsaved: boolean) {
  const { t } = useTranslation();

  // Since SDK 58 a blocked action dispatched again is blocked again: `repeat` and
  // `disablePrevention` switch the guard off first.
  const disablePrevention = usePreventRemove(unsaved, ({ repeat }) => {
    Alert.alert(t('discard.title'), t('discard.message'), [
      { text: t('discard.stay'), style: 'cancel' },
      { text: t('discard.leave'), style: 'destructive', onPress: repeat },
    ]);
  });

  return function leave(navigate: () => void) {
    disablePrevention();
    navigate();
  };
}
