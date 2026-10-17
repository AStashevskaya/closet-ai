import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { authClient } from '@/lib/auth-client';
import { colors, fonts } from '@/theme';

type SectionKey =
  | 'closet'
  | 'looks'
  | 'wantCan'
  | 'trends'
  | 'sell'
  | 'votes'
  | 'showroom'
  | 'favorites';

type Section = { key: SectionKey; icon: IconName; href?: '/closet' };

// Order and icons from the design. Sections without an href are not built yet and show "soon".
const SECTIONS: Section[] = [
  { key: 'closet', icon: 'hanger', href: '/closet' },
  { key: 'looks', icon: 'look' },
  { key: 'wantCan', icon: 'spark' },
  { key: 'trends', icon: 'trend' },
  { key: 'sell', icon: 'tag' },
  { key: 'votes', icon: 'chat' },
  { key: 'showroom', icon: 'store' },
  { key: 'favorites', icon: 'heart' },
];

export function Menu() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: session } = authClient.useSession();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('menu.title')}
      </Text>

      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Icon name="user" color={colors.iconMuted} size={26} strokeWidth={1.2} />
        </View>
        <View style={styles.profileText}>
          <Text style={styles.name} numberOfLines={1}>
            {session?.user.name}
          </Text>
          <Text style={styles.tagline}>{t('app.tagline')}</Text>
        </View>
      </View>

      <View accessibilityRole="menu" style={styles.list}>
        {SECTIONS.map(({ key, icon, href }) => {
          const ready = href !== undefined;
          return (
            <Pressable
              key={key}
              style={styles.row}
              onPress={ready ? () => router.navigate(href) : undefined}
              disabled={!ready}
              accessibilityRole="menuitem"
              accessibilityState={{ disabled: !ready }}
            >
              <Icon name={icon} color={ready ? colors.accent : colors.tabInactive} />
              <Text style={[styles.rowLabel, !ready && styles.rowLabelSoon]}>
                {t(`menu.sections.${key}`)}
              </Text>
              {ready ? (
                <View style={styles.chevron}>
                  <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
                </View>
              ) : (
                <Text style={styles.soon}>{t('menu.soon')}</Text>
              )}
            </Pressable>
          );
        })}

        <Pressable
          style={styles.row}
          onPress={() => authClient.signOut()}
          accessibilityRole="menuitem"
        >
          <Icon name="logout" color={colors.accent} />
          <Text style={[styles.rowLabel, styles.signOut]}>{t('auth.signOut')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
  },
  container: {
    paddingBottom: 24,
  },
  title: {
    paddingHorizontal: 22,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
    textAlign: 'center',
  },
  profile: {
    marginTop: 18,
    marginHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.hero,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  profileText: {
    flex: 1,
    gap: 6,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 36,
    color: colors.text,
    textAlign: 'left',
  },
  tagline: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.accent,
    textAlign: 'left',
  },
  list: {
    marginTop: 20,
    marginHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    height: 52,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  rowLabelSoon: {
    color: colors.textMuted,
  },
  signOut: {
    color: colors.accent,
  },
  soon: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.accentSoft,
    fontFamily: fonts.bodySemiBold,
    fontSize: 11,
    color: colors.accent,
  },
  // The chevron points toward the end of the row, so it flips in right-to-left layouts.
  chevron: {
    transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }],
  },
});
