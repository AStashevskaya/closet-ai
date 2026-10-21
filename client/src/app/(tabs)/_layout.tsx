import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Icon, type IconName } from '@/components/icon';
import { colors, fonts } from '@/theme';

// JS tabs rather than NativeTabs: the design's bar uses our own fonts and icons,
// which the native tab bar doesn't allow.
const TABS: {
  name: string;
  icon: IconName;
  label: 'home' | 'closet' | 'want' | 'trends' | 'profile';
}[] = [
  { name: 'index', icon: 'home', label: 'home' },
  { name: 'closet', icon: 'hanger', label: 'closet' },
  { name: 'want', icon: 'spark', label: 'want' },
  { name: 'trends', icon: 'trend', label: 'trends' },
  { name: 'profile', icon: 'user', label: 'profile' },
];

export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        // Each screen draws its own header.
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.divider },
        tabBarLabelStyle: { fontFamily: fonts.bodyMedium, fontSize: 10 },
      }}
    >
      {TABS.map(({ name, icon, label }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(`tabs.${label}`),
            tabBarIcon: ({ color, focused }) => (
              <Icon name={icon} color={color} fill={focused ? colors.accentSoft : 'none'} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
