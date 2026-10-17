import { ITEM_CATEGORIES } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '@/theme';

// Placeholder until the wardrobe exists: proves the link to @closet-ai/shared and i18n.
export function Closet() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('closet.title')}
      </Text>
      <Text style={styles.heading}>{t('closet.categories')}</Text>
      {ITEM_CATEGORIES.map((category) => (
        <Text key={category} style={styles.text}>
          {t(`categories.${category}`)}
        </Text>
      ))}
    </ScrollView>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
  },
  container: {
    paddingHorizontal: 22,
    paddingBottom: 24,
    gap: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  heading: {
    marginTop: 8,
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'left',
  },
});
