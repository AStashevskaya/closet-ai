import * as Notifications from 'expo-notifications';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { TabBar } from '@/components/tab-bar';

// JS tabs rather than NativeTabs, so the bar can be our own thread (src/components/tab-bar.tsx).
const TABS = [
  { name: 'index', label: 'closet' },
  { name: 'style', label: 'style' },
  { name: 'the-edit', label: 'brands' },
  { name: 'profile', label: 'profile' },
] as const;

// A note that comes while the app is open still shows, quietly.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// The notes already answered, for the app's life.
const handled = new Set<string>();

export default function TabsLayout() {
  const { t } = useTranslation();
  const router = useRouter();

  // A tap on the morning note opens the look of the day (src/lib/morning.ts). Signed in only (the
  // tabs exist only then), and each tap once: the last response outlives a remount, such as
  // signing out and in again.
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { identifier, content } = response.notification.request;
    if (handled.has(identifier)) return;
    handled.add(identifier);
    Notifications.clearLastNotificationResponse();
    if (content.data?.url === '/style') router.navigate('/style');
  }, [response, router]);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      // Each screen draws its own header.
      screenOptions={{ headerShown: false }}
    >
      {TABS.map(({ name, label }) => (
        <Tabs.Screen key={name} name={name} options={{ title: t(`tabs.${label}`) }} />
      ))}
    </Tabs>
  );
}
