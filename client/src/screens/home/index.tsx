import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { colors, fonts } from '@/theme';

// Home: for now the way into "what do I wear this with?" for an item from a photo. Wardrobe
// items have the same button on their own screen.
export function Home() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('tabs.home')}
      </Text>

      <View style={styles.card}>
        <Icon name="spark" color={colors.text} size={26} strokeWidth={1.3} />
        <Text style={styles.cardTitle}>{t('wearWith.homeTitle')}</Text>
        <Text style={styles.cardText}>{t('wearWith.homeText')}</Text>
        <Link href="/wear-with-pick" asChild>
          <PressableScale style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>{t('wearWith.pick')}</Text>
          </PressableScale>
        </Link>
      </View>
    </ScrollView>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 40,
    gap: 18,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  card: {
    gap: 10,
    padding: 22,
    borderRadius: 24,
    backgroundColor: colors.surface,
    boxShadow: '0 6px 18px rgba(30, 26, 23, 0.06)',
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 32,
    color: colors.text,
    textAlign: 'left',
  },
  cardText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  button: {
    marginTop: 6,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
});
