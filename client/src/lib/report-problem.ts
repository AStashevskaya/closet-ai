import Constants from 'expo-constants';
import { Platform } from 'react-native';

type Context = { userId?: string; language: string; subject: string; intro: string };

// The address testers write to, from EXPO_PUBLIC_SUPPORT_EMAIL; without it the menu leaves the
// row out rather than open an empty letter.
export const supportEmail = () => process.env.EXPO_PUBLIC_SUPPORT_EMAIL || null;

// A letter to support with what's needed to look into a problem: the app's version, the
// phone's system and language, and the account. The tester sees all of it before sending.
export function problemReportUrl({ userId, language, subject, intro }: Context): string | null {
  const to = supportEmail();
  if (!to) return null;
  const details = [
    `App: ${Constants.expoConfig?.version ?? 'unknown'}`,
    `System: ${Platform.OS} ${Platform.Version}`,
    `Language: ${language}`,
    userId ? `Account: ${userId}` : null,
  ].filter(Boolean);
  const body = `${intro}\n\n\n---\n${details.join('\n')}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
