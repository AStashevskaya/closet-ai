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

import { maison } from '@/components/maison';
import { useTabBarClearance } from '@/components/tab-bar';
import { Icon } from '@/components/icon';
import { Select, type SelectOption } from '@/components/select';
import { chosenLanguage, type Language } from '@/i18n';
import type { Item, StyledEntry } from '@closet-ai/shared';

import { ItemPhoto } from '@/components/item-photo';
import { cutoutShadow } from '@/components/cutout-shadow';
import {
  countDueWishes,
  getStyle,
  listInspiration,
  listItems,
  listStyled,
  sessionHeaders,
} from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { authClient } from '@/lib/auth-client';
import { setLanguage } from '@/lib/language';
import { useUsage } from '@/lib/limits';
import { problemReportUrl, supportEmail } from '@/lib/report-problem';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { ProfileThread, Stop } from './thread';

// GET /api/wear-with returns the newest 30: past that the count reads "30+".
const STYLED_SHOWN = 30;

// What the thread's stops tell: counts, the last piece styled and the first one added.
type Story = {
  pieces: number;
  saved: number;
  styled: StyledEntry[];
  first: Item | null;
};

type Section = {
  key: 'closet' | 'looks' | 'wantCan' | 'wishes' | 'theEdit';
  href: '/' | '/style' | '/want-can' | '/wishes' | '/the-edit';
};

// Each language by its own name, so it can be found whatever the app is in now.
// Russian first: the first market is Belarus.
const LANGUAGES: SelectOption<Language>[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית' },
];

// Only what the app has: sections not built yet aren't shown at all.
const SECTIONS: Section[] = [
  { key: 'closet', href: '/' },
  { key: 'looks', href: '/style' },
  { key: 'wantCan', href: '/want-can' },
  { key: 'wishes', href: '/wishes' },
  { key: 'theEdit', href: '/the-edit' },
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
  const [story, setStory] = useState<Story | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>();
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
      const loadStory = async () => {
        try {
          const [items, saved, styled, auth] = await Promise.all([
            listItems(),
            listInspiration(),
            listStyled(),
            sessionHeaders(),
          ]);
          const first = items.reduce<Item | null>(
            (oldest, item) => (!oldest || item.createdAt < oldest.createdAt ? item : oldest),
            null,
          );
          setStory({ pieces: items.length, saved: saved.length, styled, first });
          setHeaders(auth);
        } catch {
          // The thread waits for the next visit; the menu works without it.
        }
      };
      void load();
      void loadStyle();
      void loadStory();
    }, [i18n.language]),
  );

  async function pickLanguage(choice: Language | null) {
    // Select reports only a change, so the same language never gets here.
    if (switching) return;
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
      <Animated.View entering={rise} style={[maison.gutter, styles.head]}>
        <Text style={maison.note}>{t('menu.thread')}</Text>
        <Text style={styles.name} numberOfLines={2} accessibilityRole="header">
          {session?.user.name}
        </Text>
        {style ? (
          <Text
            style={[maison.body, styles.letter]}
            accessibilityLabel={`${t('style.title')}: ${style}`}
          >
            {style}
          </Text>
        ) : (
          <Text style={[maison.body, styles.letter]}>{t('app.tagline')}</Text>
        )}
      </Animated.View>

      <ProfileThread>
        {usage && (
          <Stop
            index={0}
            note={t('menu.usage.wear_with')}
            big={`${usage.wear_with.used} / ${usage.wear_with.limit}`}
          >
            {(['want', 'look'] as const).map((action) => (
              <Text key={action} style={maison.note}>
                {t(`menu.usage.${action}`)}: {usage[action].used} / {usage[action].limit}
              </Text>
            ))}
          </Stop>
        )}
        {story?.styled[0] && (
          <Stop index={1} note={t('menu.lastStyled')} big={story.styled[0].name}>
            <View style={[styles.thumb, cutoutShadow('flat')]}>
              <ItemPhoto
                item={{
                  photoUrl: story.styled[0].photoUrl ?? undefined,
                  cutoutUrl: story.styled[0].cutoutUrl ?? undefined,
                }}
                headers={headers}
                style={styles.thumbImage}
              />
            </View>
          </Stop>
        )}
        {story && (
          <Stop
            index={2}
            note={t('menu.counts')}
            big={[
              story.pieces,
              story.saved,
              story.styled.length >= STYLED_SHOWN ? `${STYLED_SHOWN}+` : story.styled.length,
            ].join(' · ')}
          />
        )}
        {story?.first && (
          <Stop index={3} note={t('menu.firstPiece')} big={story.first.name}>
            {session?.user.createdAt && (
              <Text style={maison.note}>
                {t('menu.joined', {
                  date: new Date(session.user.createdAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                })}
              </Text>
            )}
          </Stop>
        )}
      </ProfileThread>

      <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={maison.gutter}>
        <Select
          label={t('menu.language')}
          value={language}
          options={[{ value: null, label: t('menu.languageAuto') }, ...LANGUAGES]}
          onChange={pickLanguage}
          disabled={switching}
        />
      </Animated.View>

      <View accessibilityRole="menu" style={styles.list}>
        <Pressable
          style={styles.row}
          onPress={() => router.push('/profile-details')}
          accessibilityRole="menuitem"
        >
          <Text style={styles.rowLabel}>{t('details.row')}</Text>
          <View style={styles.chevron}>
            <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
          </View>
        </Pressable>
        {SECTIONS.map(({ key, href }) => (
          <Pressable
            key={key}
            style={styles.row}
            onPress={() => router.navigate(href)}
            accessibilityRole="menuitem"
          >
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
  head: {
    gap: 4,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  letter: {
    marginTop: 6,
  },
  thumb: {
    marginTop: 8,
    width: 56,
    height: 56,
  },
  thumbImage: {
    width: 56,
    height: 56,
  },
  list: {
    marginHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // The menu is set in the display face, like the prototype's index of sections.
  rowLabel: {
    flex: 1,
    paddingVertical: 8,
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
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
