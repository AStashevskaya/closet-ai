// Hermes may have no Intl.PluralRules, and i18next then can't pick a plural form («7 вещи»). It
// installs itself only where the engine lacks it or its languages.
import 'intl-pluralrules';

import { getLocales } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import he from './locales/he.json';
import ru from './locales/ru.json';

export const SUPPORTED_LANGUAGES = ['en', 'he', 'ru'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// What a phone in any other language gets.
export const FALLBACK_LANGUAGE: Language = 'en';

export const resources = {
  en: { translation: en },
  he: { translation: he },
  ru: { translation: ru },
} as const;

function isSupported(code: string | null): code is Language {
  return SUPPORTED_LANGUAGES.includes(code as Language);
}

// A language we don't have, read as the one its speakers read best (owner, 2026-11-11). Belarus
// is the first market and reads Russian. Ukrainian is left out on purpose: those phones get
// English until there's a Ukrainian locale, not Russian.
const NEAREST: Record<string, Language> = {
  be: 'ru',
};

// The first language in the user's device preference list that we have, or its nearest.
export function detectLanguage(): Language {
  for (const { languageCode } of getLocales()) {
    if (isSupported(languageCode)) return languageCode;
    const nearest = languageCode ? NEAREST[languageCode] : undefined;
    if (nearest) return nearest;
  }
  return FALLBACK_LANGUAGE;
}

// The language picked in the profile, kept on the phone; none follows the phone's languages.
export const LANGUAGE_KEY = 'closet.language';
export function chosenLanguage(): Language | null {
  try {
    const stored = SecureStore.getItem(LANGUAGE_KEY);
    return isSupported(stored) ? stored : null;
  } catch {
    return null;
  }
}

// i18next's default export is the instance, so `i18n.use` is the intended call.
// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  resources,
  lng: chosenLanguage() ?? detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  // Resources are bundled, so init can finish synchronously before the first render.
  initAsync: false,
  // React already escapes text it renders.
  interpolation: { escapeValue: false },
});

export default i18n;
