import { APP_LANGUAGES, type AppLanguage } from '@closet-ai/shared';

// The app's language as the server knows it; English is the fallback, as in i18n.
export const appLanguage = (language: string): AppLanguage =>
  (APP_LANGUAGES as readonly string[]).includes(language) ? (language as AppLanguage) : 'en';
