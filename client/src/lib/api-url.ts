import Constants from 'expo-constants';

const API_PORT = 3000;

// Base URL of the API server.
// EXPO_PUBLIC_API_URL wins when set (a deployed server). Otherwise, in development, the phone
// reaches the API on the computer's LAN address: the same host Metro serves the app from.
export function apiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${devHost ?? 'localhost'}:${API_PORT}`;
}
