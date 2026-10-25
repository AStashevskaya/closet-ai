import i18n from '@/i18n';

import { limitText } from './limits';

jest.mock('./api', () => ({ getUsage: jest.fn() }));

describe('limitText', () => {
  test('says when the monthly AI allowance is back: on the 1st of next month', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-24T12:00:00Z') });
    await i18n.changeLanguage('en');
    expect(limitText(i18n.t, 'en', 'monthly')).toBe(
      "That's all the AI styling for this month. It's back on November 1.",
    );
    jest.useRealTimers();
  });
});
