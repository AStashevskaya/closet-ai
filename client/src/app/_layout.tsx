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
    // No long-press history on the back button: the stack is shallow, and the tabs screen has
    // no title of its own to show there (it read "(tabs)").
    <Stack screenOptions={{ headerBackButtonMenuEnabled: false }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="add-item"
          options={{
            presentation: 'modal',
            title: t('addItem.title'),
            // The screen opens on the blue band of a new piece arriving; the header is part of it.
            headerStyle: { backgroundColor: colors.ground },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="add-items"
          options={{
            presentation: 'modal',
            title: t('addItems.title'),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="add-look"
          options={{
            presentation: 'modal',
            title: t('addLook.title'),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
          }}
        />
        {/* See-through: the item's photo runs under it, and the name is on the page. */}
        <Stack.Screen
          name="item/[id]"
          options={{
            title: '',
            headerTransparent: true,
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="want-can"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
          }}
        />
        <Stack.Screen
          name="wear-with-pick"
          options={{
            presentation: 'modal',
            title: t('wearWith.title'),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="wear-with/[id]"
          options={{
            title: t('wearWith.title'),
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
          }}
        />
        {/* A closet piece's outfits on the thread; the piece's name heads the page. */}
        <Stack.Screen
          name="styled/[id]"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="wishes"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="closet/[category]"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="the-edit"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="catalog/[id]"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="profile-details"
          options={{
            title: t('details.title'),
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
          }}
        />
        <Stack.Screen
          name="delete-account"
          options={{
            presentation: 'modal',
            title: t('deleteAccount.title'),
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.text },
            headerShadowVisible: false,
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
