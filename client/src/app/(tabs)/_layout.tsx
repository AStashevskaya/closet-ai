import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TabBar } from '@/components/tab-bar';

// JS tabs rather than NativeTabs, so the bar can be our own thread (src/components/tab-bar.tsx).
const TABS = [
  { name: 'index', label: 'closet' },
  { name: 'style', label: 'style' },
  { name: 'inspiration', label: 'inspiration' },
  { name: 'profile', label: 'profile' },
] as const;

export default function TabsLayout() {
  const { t } = useTranslation();

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
