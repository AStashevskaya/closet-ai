import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { I18nManager } from 'react-native';

import i18n, { LANGUAGE_KEY } from '@/i18n';

import { setLanguage } from './language';

jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(() => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'he' }] }));

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(I18nManager, 'allowRTL');
  jest.spyOn(I18nManager, 'forceRTL');
  await i18n.changeLanguage('en');
});

describe('setLanguage', () => {
  test('switches between English and Russian in place, and keeps the choice', async () => {
    await setLanguage('ru');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(LANGUAGE_KEY, 'ru');
    expect(i18n.language).toBe('ru');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(reloadAppAsync).not.toHaveBeenCalled();
  });

  test('reloads into Hebrew, right to left', async () => {
    await setLanguage('he');
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reloadAppAsync).toHaveBeenCalled();
  });

  test("goes back to the phone's language: a Hebrew phone gets Hebrew again", async () => {
    await setLanguage(null);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(LANGUAGE_KEY);
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(reloadAppAsync).toHaveBeenCalled();
  });
});
