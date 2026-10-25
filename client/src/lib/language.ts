import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { I18nManager } from 'react-native';

import i18n, { detectLanguage, LANGUAGE_KEY, type Language } from '@/i18n';

// Switches the app's language; null goes back to the phone's. English and Russian change in
// place. Hebrew also changes the layout direction and the fonts, which are read once at start
// (I18nManager, src/theme.ts), so the app reloads into it. Direction doesn't change in Expo Go.
export async function setLanguage(choice: Language | null) {
  if (choice) await SecureStore.setItemAsync(LANGUAGE_KEY, choice);
  else await SecureStore.deleteItemAsync(LANGUAGE_KEY);

  const next = choice ?? detectLanguage();
  const rtl = next === 'he';
  // Following the phone, a Hebrew phone gets right-to-left again; a picked language decides.
  I18nManager.allowRTL(choice === null || rtl);
  I18nManager.forceRTL(choice !== null && rtl);
  if (rtl !== (i18n.language === 'he')) {
    await reloadAppAsync();
    return;
  }
  await i18n.changeLanguage(next);
}
