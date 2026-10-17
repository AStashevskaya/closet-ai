import { ITEM_CATEGORIES } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { authClient } from '@/lib/auth-client';

// Placeholder until the wardrobe screen exists: proves the link to @closet-ai/shared and i18n.
export function Home() {
  const { t } = useTranslation();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={[styles.text, styles.title]}>{t('home.title')}</Text>
      <Text style={[styles.text, styles.heading]}>{t('home.categories')}</Text>
      {ITEM_CATEGORIES.map((category) => (
        <Text key={category} style={styles.text}>
          {t(`categories.${category}`)}
        </Text>
      ))}
      <Pressable onPress={() => authClient.signOut()} accessibilityRole="button">
        <Text style={[styles.text, styles.link]}>{t('auth.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 8,
  },
  text: {
    fontSize: 16,
    // textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
    textAlign: 'left',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
  },
  heading: {
    marginTop: 8,
    fontWeight: '600',
  },
  link: {
    marginTop: 16,
    color: '#1565c0',
  },
});
