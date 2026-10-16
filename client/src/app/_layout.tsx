import '@/i18n';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { authClient } from '@/lib/auth-client';

// Keep the splash screen up until we know whether there is a session,
// so a signed-in user never sees the sign-in screen flash by.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { t } = useTranslation();
  const { data: session, isPending } = authClient.useSession();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (!isPending) SplashScreen.hideAsync();
  }, [isPending]);

  if (isPending) return null;

  // Protected screens exist only while their guard is true; Expo Router redirects away otherwise.
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: t('home.title') }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: t('auth.signIn') }} />
        <Stack.Screen name="sign-up" options={{ title: t('auth.signUp') }} />
      </Stack.Protected>
    </Stack>
  );
}
