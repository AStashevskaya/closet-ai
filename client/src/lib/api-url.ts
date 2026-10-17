import Constants from 'expo-constants';

const API_PORT = 3000;

// Base URL of the API server.
// EXPO_PUBLIC_API_URL wins when set (a deployed server). Otherwise, in development, the phone
// reaches the API on the computer's LAN address: the same host Metro serves the app from.
export function apiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  // A release build has no dev server to fall back to; failing here beats calling localhost on the phone.
  if (!__DEV__) {
    throw new Error('EXPO_PUBLIC_API_URL must be set for release builds');
  }

  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost ?? 'localhost'}:${API_PORT}`;
}
