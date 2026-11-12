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

export default function TabsLayout() {
  const { t } = useTranslation();
  const router = useRouter();

  // A tap on the morning note opens the look of the day (src/lib/morning.ts).
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const url = response.notification.request.content.data?.url;
    if (url === '/style') router.navigate('/style');
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
