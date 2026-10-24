import { renderHook } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router/react-navigation';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';

import { useConfirmLeave } from './use-confirm-leave';

const disablePrevention = jest.fn();

jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(usePreventRemove).mockReturnValue(disablePrevention);
  await i18n.changeLanguage('en');
});

// The callback the hook hands usePreventRemove, called as when a swipe down is blocked.
function blockLeaving(repeat: () => void) {
  const callback = jest.mocked(usePreventRemove).mock.calls.at(-1)![1]!;
  callback({ data: { action: { type: 'GO_BACK' } }, repeat });
}

describe('useConfirmLeave', () => {
  test('asks first, and "Leave" lets the blocked navigation through', async () => {
    jest.spyOn(Alert, 'alert');
    await renderHook(() => useConfirmLeave(true));
    const repeat = jest.fn();
    blockLeaving(repeat);

    const buttons = jest.mocked(Alert.alert).mock.calls[0]![2] as AlertButton[];
    buttons.find((b) => b.style === 'destructive')!.onPress!();
    expect(repeat).toHaveBeenCalledTimes(1);
  });

  test('switches the guard off before its own navigation', async () => {
    const { result } = await renderHook(() => useConfirmLeave(true));
    const navigate = jest.fn(() => expect(disablePrevention).toHaveBeenCalled());
    result.current(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
