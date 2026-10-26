import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  I18nManager,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Animated from 'react-native-reanimated';

import { maison, ScreenTitle, SectionLabel } from '@/components/maison';
import { useTabBarClearance } from '@/components/tab-bar';
import { Icon, type IconName } from '@/components/icon';
import { chosenLanguage, type Language } from '@/i18n';
import { countDueWishes, getStyle } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { authClient } from '@/lib/auth-client';
import { setLanguage } from '@/lib/language';
import { useUsage } from '@/lib/limits';
import { problemReportUrl, supportEmail } from '@/lib/report-problem';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

type Section = {
  key: 'closet' | 'looks' | 'wantCan' | 'wishes' | 'theEdit';
  icon: IconName;
  href: '/' | '/style' | '/want-can' | '/wishes' | '/the-edit';
};

// Each language by its own name, so it can be found whatever the app is in now.
const LANGUAGES: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'he', name: 'עברית' },
];

// Only what the app has: sections not built yet aren't shown at all.
const SECTIONS: Section[] = [
  { key: 'closet', icon: 'hanger', href: '/' },
  { key: 'looks', icon: 'look', href: '/style' },
  { key: 'wantCan', icon: 'spark', href: '/want-can' },
  { key: 'wishes', icon: 'heart', href: '/wishes' },
  { key: 'theEdit', icon: 'store', href: '/the-edit' },
];

export function Menu() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const { data: session } = authClient.useSession();
  const { usage } = useUsage();
  // Wishes waiting for "still want it?", shown on their row; reloaded when the tab comes back.
  const [due, setDue] = useState(0);
  // Her style in a few sentences, once the first brief is written.
  const [style, setStyle] = useState<string | null>(null);
  // null: the phone's languages.
  const [language, setChoice] = useState(chosenLanguage);
  // While a pick is saved (or the app reloads into it), the rows wait.
  const [switching, setSwitching] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          setDue(await countDueWishes());
        } catch {
          // Only a hint: the row works without it.
        }
      };
      const loadStyle = async () => {
        try {
          setStyle((await getStyle(appLanguage(i18n.language))).summary);
        } catch {
          // Nice to read, not needed.
        }
      };
      void load();
      void loadStyle();
    }, [i18n.language]),
  );

  async function pickLanguage(choice: Language | null) {
    if (switching || choice === language) return;
    const before = language;
    setChoice(choice);
    setSwitching(true);
    try {
      await setLanguage(choice);
    } catch {
      // It didn't go through: show what the app is still in.
      setChoice(before);
    } finally {
      setSwitching(false);
    }
  }

  async function report() {
    const url = problemReportUrl({
      userId: session?.user.id,
      language: i18n.language,
      subject: t('menu.reportSubject'),
      intro: t('menu.reportIntro'),
    });
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      // No mail app set up: the address at least.
      Alert.alert(t('menu.noMail', { email: supportEmail() }));
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + 12, paddingBottom: clearance },
      ]}
    >
      <Animated.View entering={rise} style={[maison.gutter, styles.profile]}>
        <ScreenTitle title={t('menu.title')} />
        <Text style={styles.name} numberOfLines={1}>
          {session?.user.name}
        </Text>
        <Text style={maison.note}>{t('app.tagline')}</Text>
      </Animated.View>

      {style && (
        <Animated.View entering={rise.delay(STAGGER_STEP)} style={[maison.gutter, styles.style]}>
          <SectionLabel>{t('style.title')}</SectionLabel>
          <Text style={maison.body}>{style}</Text>
        </Animated.View>
      )}

      {usage && (
        <Animated.View entering={rise.delay(STAGGER_STEP)} style={[maison.gutter, styles.usage]}>
          <SectionLabel>{t('menu.limits')}</SectionLabel>
          {(['wear_with', 'want', 'look'] as const).map((action) => (
            <View key={action} style={styles.usageRow}>
              <Text style={styles.usageLabel}>{t(`menu.usage.${action}`)}</Text>
              <Text style={styles.usageValue}>
                {usage[action].used} / {usage[action].limit}
              </Text>
            </View>
          ))}
        </Animated.View>
      )}

      <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={maison.gutter}>
        <SectionLabel>{t('menu.language')}</SectionLabel>
        <View accessibilityRole="radiogroup">
          {[{ code: null, name: t('menu.languageAuto') }, ...LANGUAGES].map(({ code, name }) => (
            <Pressable
              key={code ?? 'auto'}
              style={styles.languageRow}
              onPress={() => pickLanguage(code)}
              accessibilityRole="radio"
              accessibilityState={{ checked: language === code }}
            >
              <Text style={styles.languageLabel}>{name}</Text>
              {language === code && <Icon name="check" color={colors.text} size={18} />}
            </Pressable>
          ))}
        </View>
      </Animated.View>

      <View accessibilityRole="menu" style={styles.list}>
        <Pressable
          style={styles.row}
          onPress={() => router.push('/profile-details')}
          accessibilityRole="menuitem"
        >
          <Icon name="user" color={colors.text} />
          <Text style={styles.rowLabel}>{t('details.row')}</Text>
          <View style={styles.chevron}>
            <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
          </View>
        </Pressable>
        {SECTIONS.map(({ key, icon, href }) => (
          <Pressable
            key={key}
            style={styles.row}
            onPress={() => router.navigate(href)}
            accessibilityRole="menuitem"
          >
            <Icon name={icon} color={colors.text} />
            <Text style={styles.rowLabel}>{t(`menu.sections.${key}`)}</Text>
            {key === 'wishes' && due > 0 && (
              <Text style={styles.due}>{t('wishes.due', { count: due })}</Text>
            )}
            <View style={styles.chevron}>
              <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
            </View>
          </Pressable>
        ))}

        {supportEmail() && (
          <Pressable style={styles.row} onPress={report} accessibilityRole="menuitem">
            <Icon name="chat" color={colors.text} />
            <Text style={styles.rowLabel}>{t('menu.report')}</Text>
          </Pressable>
        )}
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
    gap: 28,
  },
  profile: {
    gap: 6,
  },
  name: {
    marginTop: 8,
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  usage: {
    gap: 2,
  },
  style: {
    gap: 8,
  },
  usageRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  usageLabel: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  languageRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  languageLabel: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  usageValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  list: {
    marginHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  due: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.bead,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.onBead,
  },
  // The chevron points toward the end of the row, so it flips in right-to-left layouts.
  chevron: {
    transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }],
  },
});
