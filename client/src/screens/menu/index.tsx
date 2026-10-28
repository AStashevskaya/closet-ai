import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
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
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

// The thread's lists change only when she adds or styles something, so a quick return to the tab
// doesn't fetch them again.
const STORY_FRESH_MS = 60_000;

// The oldest piece. createdAt is ISO in UTC everywhere, so the strings sort as the dates do.
const firstOf = (items: Item[]) =>
  items.reduce<Item | null>(
    (oldest, item) => (!oldest || item.createdAt < oldest.createdAt ? item : oldest),
    null,
  );

type StopData = { key: string; note: string; big: string; children?: ReactNode };

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
  // The thread's lists, each on its own: one that fails leaves only its stops out.
  const [items, setItems] = useState<Item[] | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [styled, setStyled] = useState<StyledEntry[] | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>();
  const storyLoadedAt = useRef(0);
  // null: the phone's languages.
  const [language, setChoice] = useState(chosenLanguage);
  // While a pick is saved (or the app reloads into it), the rows wait.
  const [switching, setSwitching] = useState(false);
  useFocusEffect(
    useCallback(() => {
      // Answers that come back after she left the tab, or after a newer visit asked again, are dropped.
      let gone = false;
      const load = async () => {
        try {
          const count = await countDueWishes();
          if (!gone) setDue(count);
        } catch {
          // Only a hint: the row works without it.
        }
      };
      const loadStyle = async () => {
        try {
          const { summary } = await getStyle(appLanguage(i18n.language));
          if (!gone) setStyle(summary);
        } catch {
          // Nice to read, not needed.
        }
      };
      void load();
      void loadStyle();
      return () => {
        gone = true;
      };
    }, [i18n.language]),
  );
  useFocusEffect(
    useCallback(() => {
      let gone = false;
      if (Date.now() - storyLoadedAt.current < STORY_FRESH_MS) return;
      storyLoadedAt.current = Date.now();
      const settle = <T,>(request: Promise<T>, keep: (value: T) => void) =>
        request.then(
          (value) => {
            if (!gone) keep(value);
          },
          () => {
            // That stop waits for the next visit; the rest of the thread shows.
            storyLoadedAt.current = 0;
          },
        );
      void settle(listItems(), setItems);
      void settle(listInspiration(), (list) => setSaved(list.length));
      void settle(listStyled(), setStyled);
      void settle(sessionHeaders(), setHeaders);
      return () => {
        gone = true;
      };
    }, []),
  );

  const first = items && firstOf(items);
  const last = styled?.[0];
  const stops: StopData[] = [];
  if (usage) {
    stops.push({
      key: 'today',
      note: t('menu.usage.wear_with'),
      big: `${usage.wear_with.used} / ${usage.wear_with.limit}`,
      children: (['want', 'look'] as const).map((action) => (
        <Text key={action} style={maison.note}>
          {t(`menu.usage.${action}`)}: {usage[action].used} / {usage[action].limit}
        </Text>
      )),
    });
  }
  if (last) {
    stops.push({
      key: 'last',
      note: t('menu.lastStyled'),
      big: last.name,
      children: (
        <View style={[styles.thumb, cutoutShadow('flat')]}>
          <ItemPhoto
            item={{ photoUrl: last.photoUrl ?? undefined, cutoutUrl: last.cutoutUrl ?? undefined }}
            headers={headers}
            style={styles.thumbImage}
          />
        </View>
      ),
    });
  }
  if (items && saved !== null && styled) {
    stops.push({
      key: 'counts',
      note: t('menu.counts'),
      big: [
        items.length,
        saved,
        styled.length >= STYLED_SHOWN ? `${STYLED_SHOWN}+` : styled.length,
      ].join(' · '),
    });
  }
  if (first) {
    stops.push({
      key: 'first',
      note: t('menu.firstPiece'),
      big: first.name,
      children: session?.user.createdAt && (
        <Text style={maison.note}>
          {t('menu.joined', {
            date: new Date(session.user.createdAt).toLocaleDateString(i18n.language, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </Text>
      ),
    });
  }

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

      {/* Drawn once there is something to thread: the line grows with the stops it holds. */}
      {stops.length > 0 && (
        <ProfileThread>
          {stops.map(({ key, ...stop }, index) => (
            <Stop key={key} index={index} {...stop} />
          ))}
        </ProfileThread>
      )}

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
