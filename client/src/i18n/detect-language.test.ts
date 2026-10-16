import { getLocales, type Locale } from 'expo-localization';

import { detectLanguage } from '.';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => []) }));

// Only languageCode matters for detection; the rest of Locale is irrelevant here.
const locale = (languageCode: string) => ({ languageCode }) as Locale;

function deviceLanguages(first: string, ...rest: string[]) {
  jest.mocked(getLocales).mockReturnValue([locale(first), ...rest.map(locale)]);
}

describe('detectLanguage', () => {
  test('uses the device language when it is supported', () => {
    deviceLanguages('he');
    expect(detectLanguage()).toBe('he');
  });

  test('takes the first supported language from the preference list', () => {
    deviceLanguages('de', 'ru', 'he');
    expect(detectLanguage()).toBe('ru');
  });

  test('falls back to English for an unsupported language', () => {
    deviceLanguages('fr');
    expect(detectLanguage()).toBe('en');
  });
});
