import '@/i18n';

import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { fontAssets } from '@/fonts';
import { authClient } from '@/lib/auth-client';
import { colors, fonts } from '@/theme';

// Keep the splash screen up until fonts are loaded and we know whether there is a session,
// so a signed-in user never sees the sign-in screen flash by, and text never jumps fonts.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { t } = useTranslation();
  const { data: session, isPending } = authClient.useSession();
  // A font that fails to load falls back to the system font rather than blocking the app.
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const ready = !isPending && (fontsLoaded || fontError !== null);
  const signedIn = Boolean(session);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  // Protected screens exist only while their guard is true; Expo Router redirects away otherwise.
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="add-item"
          options={{
            presentation: 'modal',
            title: t('addItem.title'),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        {/* The auth screens draw their own full-bleed header. */}
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
