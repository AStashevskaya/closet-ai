import i18n from '@/i18n';

import { limitText } from './limits';

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
