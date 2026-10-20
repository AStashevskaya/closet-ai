import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

// Keeps a screen with unsaved work open: a swipe down on the modal sheet (easy to do by
// pulling a list past its top), the Android back button or a header button asks first.
// Returns `leave`, which runs a navigation of the screen's own (saved, or replaced by another
// screen on purpose) without asking.
export function useConfirmLeave(unsaved: boolean) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const allowed = useRef(false);

  usePreventRemove(unsaved, ({ data }) => {
    if (allowed.current) return navigation.dispatch(data.action);
    Alert.alert(t('discard.title'), t('discard.message'), [
      { text: t('discard.stay'), style: 'cancel' },
      {
        text: t('discard.leave'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  return function leave(navigate: () => void) {
    allowed.current = true;
    navigate();
  };
}
