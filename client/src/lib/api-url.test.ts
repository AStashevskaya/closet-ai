import { apiUrl } from './api-url';

jest.mock('expo-constants', () => ({ expoConfig: { hostUri: '192.168.1.20:8081' } }));

const globals = globalThis as unknown as { __DEV__: boolean };
const originalDev = globals.__DEV__;

afterEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  globals.__DEV__ = originalDev;
});

describe('apiUrl', () => {
  test('uses EXPO_PUBLIC_API_URL when set', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com';
    expect(apiUrl()).toBe('https://api.example.com');
  });

  test('uses the dev server host in development', () => {
    globals.__DEV__ = true;
    expect(apiUrl()).toBe('http://192.168.1.20:3000');
  });

  test('throws in a release build without EXPO_PUBLIC_API_URL', () => {
    globals.__DEV__ = false;
    expect(() => apiUrl()).toThrow('EXPO_PUBLIC_API_URL');
  });
});
