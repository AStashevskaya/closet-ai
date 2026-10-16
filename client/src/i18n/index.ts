import { getLocales } from 'expo-localization';
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

// First supported language in the user's device preference list.
export function detectLanguage(): Language {
  const match = getLocales().find((locale) => isSupported(locale.languageCode));
  return (match?.languageCode as Language | undefined) ?? FALLBACK_LANGUAGE;
}

i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  // Resources are bundled, so init can finish synchronously before the first render.
  initAsync: false,
  // React already escapes text it renders.
  interpolation: { escapeValue: false },
});

export default i18n;
