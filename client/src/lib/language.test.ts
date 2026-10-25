import { reloadAppAsync } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { I18nManager } from 'react-native';

import i18n, { chosenLanguage, LANGUAGE_KEY } from '@/i18n';

import { setLanguage } from './language';

jest.mock('expo', () => ({ reloadAppAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(() => null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'he' }] }));

afterEach(() => {
  jest.restoreAllMocks();
});

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

  test('leaves Hebrew for Russian with a reload, left to right', async () => {
    await i18n.changeLanguage('he');
    await setLanguage('ru');
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(false);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(reloadAppAsync).toHaveBeenCalled();
  });

  test('picking Hebrew while in Hebrew needs no reload', async () => {
    await i18n.changeLanguage('he');
    await setLanguage('he');
    expect(reloadAppAsync).not.toHaveBeenCalled();
  });
});

describe('chosenLanguage', () => {
  test('ignores anything stored that is not a language, or a store that fails', () => {
    jest.mocked(SecureStore.getItem).mockReturnValueOnce('de');
    expect(chosenLanguage()).toBeNull();
    jest.mocked(SecureStore.getItem).mockImplementationOnce(() => {
      throw new Error('locked');
    });
    expect(chosenLanguage()).toBeNull();
    jest.mocked(SecureStore.getItem).mockReturnValueOnce('ru');
    expect(chosenLanguage()).toBe('ru');
  });
});
