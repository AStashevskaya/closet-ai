import i18n from '@/i18n';

import { Alert } from 'react-native';

import { ApiError } from './api-error';
import { alertAskFailed, limitText } from './limits';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: (...a: unknown[]) => mockPush(...a) },
}));

jest.mock('./api', () => ({ getUsage: jest.fn() }));

afterEach(() => {
  jest.useRealTimers();
});

describe('limitText', () => {
  test('says when the monthly AI allowance is back: on the 1st of next month', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-24T12:00:00Z') });
    await i18n.changeLanguage('en');
    expect(limitText(i18n.t, 'en', 'monthly')).toBe(
      "That's all the AI styling for this month. It's back on November 1.",
    );
  });

  test('crosses the year end, and speaks Russian', async () => {
    jest.useFakeTimers({ now: new Date('2026-12-20T12:00:00Z') });
    await i18n.changeLanguage('ru');
    expect(limitText(i18n.t, 'ru', 'monthly')).toBe(
      'ИИ-подборки на этот месяц закончились. Вернутся с 1 января.',
    );
  });
});

describe('alertAskFailed', () => {
  test('says what the closet lacks for a whole look, and offers to add it on its rail', async () => {
    await i18n.changeLanguage('en');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    alertAskFailed(i18n.t, 'en', new ApiError(422, 'incomplete:bottom'));

    const [text, , buttons] = alert.mock.calls.at(-1)!;
    expect(text).toBe(
      'To put looks together around this piece, I need trousers, a skirt or shorts in your closet.',
    );
    buttons!.find((b) => b.text === 'Add a piece')!.onPress!();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/add-item',
      params: { category: 'bottom' },
    });
  });
});
