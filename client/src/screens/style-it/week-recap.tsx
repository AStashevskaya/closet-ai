import type { Outfit, WeekLooks } from '@closet-ai/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { MiniLook } from '@/components/mini-look';
import { getWeekLooks } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { arrive, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// From Sunday at this hour the week is told; it goes with Sunday.
const FROM_HOUR = 17;
// The thread, and how far each worn day's look hangs below it: one long, one short, in turn, so
// two days side by side don't overlap.
const THREAD_Y = 24;
const DROPS = [18, 118];
const LOOK_WIDTH = 72;
const LOOK_HEIGHT = 118;

// Sunday evening, on the phone's clock.
export const isRecapTime = (now: Date) => now.getDay() === 0 && now.getHours() >= FROM_HOUR;

// The clock, kept stable for the focus effect (a new function each render would re-run it).
const clock = () => new Date();
// The phone's own date (YYYY-MM-DD).
const phoneDate = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

// The week's recap on Sunday evening (decided 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-hooks`, A): the week's thread, as on the look of the day,
// with the look she wore hanging under each day's bead and a dashed bead for a day without; above
// it, by hand, how many days, and whether no look came twice. A reward for the habit, no new sign.
// Nothing at all for a week she marked nothing in. Sharing it comes later.
export function WeekRecap({
  headers,
  now = clock,
}: {
  headers: Record<string, string> | undefined;
  now?: () => Date;
}) {
  const { t, i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  const [week, setWeek] = useState<WeekLooks | null>(null);
  const [width, setWidth] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!isRecapTime(now())) {
        setWeek(null);
        return;
      }
      let current = true;
      Promise.resolve()
        .then(() => getWeekLooks(lang))
        // Her city's week must be the one ending today on the phone: travelling, or a city in
        // another time zone, it may already be Monday there, and an empty new week isn't a recap.
        .then((answer) => current && setWeek(answer.to === phoneDate(now()) ? answer : null))
        // A bonus on top of Style it: if it can't be read, it just isn't there.
        .catch((cause: unknown) => {
          if (__DEV__) console.warn('The week recap failed', cause);
          if (current) setWeek(null);
        });
      return () => {
        current = false;
      };
    }, [lang, now]),
  );

  // Her own pieces in a look: a look whose pieces she has since deleted shows as a day without.
  const piecesOf = (look: Outfit | null) =>
    look ? look.pieces.flatMap((p) => (p.item ? [p.item] : [])) : [];
  const worn = week?.days.filter((d) => piecesOf(d.look).length > 0) ?? [];
  if (!week || worn.length === 0) return null;

  // The same pieces on two days is the same look.
  const distinct = new Set(
    worn.map((d) =>
      piecesOf(d.look)
        .map((p) => p.id)
        .sort()
        .join('|'),
    ),
  );
  const noRepeat = worn.length >= 2 && distinct.size === worn.length;
  const dayName = (date: string, style: 'short' | 'long') =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: style,
      timeZone: 'UTC',
    });
  const dayMonth = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const column = width / 7;
  // On a narrow phone the looks shrink, so neighbours on their alternating strings don't meet.
  const scale = Math.min(1, (column * 1.5) / LOOK_WIDTH);

  return (
    <Animated.View entering={arrive} style={styles.card} testID="week-recap">
      <Text style={styles.caps} accessibilityRole="header">
        {t('today.recap.title', { range: `${dayMonth(week.from)} – ${dayMonth(week.to)}` })}
      </Text>
      <Text style={styles.hand}>
        {t('today.recap.days', { count: worn.length })}
        {noRepeat ? ` — ${t('today.recap.noRepeat')}` : ''}
      </Text>
      <View
        style={[styles.week, { height: THREAD_Y + DROPS[1]! + LOOK_HEIGHT + 8 }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <View
            style={[styles.thread, { start: column / 2, end: column / 2 }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}
        {width > 0 &&
          week.days.map((d, i) => {
            const middle = column * (i + 0.5);
            const drop = DROPS[i % 2]!;
            const pieces = piecesOf(d.look);
            return (
              <View
                key={d.date}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
                accessible={pieces.length > 0}
                accessibilityLabel={
                  pieces.length > 0
                    ? t('today.recap.day', {
                        day: dayName(d.date, 'long'),
                        pieces: pieces.map((p) => p.name).join(', '),
                      })
                    : undefined
                }
              >
                <Text style={[styles.dayName, { start: middle - 20 }]}>
                  {dayName(d.date, 'short')}
                </Text>
                <View
                  style={[
                    styles.bead,
                    pieces.length === 0 && styles.beadEmpty,
                    { start: middle - 6, top: THREAD_Y - 6 },
                  ]}
                />
                {d.look && pieces.length > 0 && (
                  <>
                    <View
                      style={[
                        styles.string,
                        { start: middle - 0.65, top: THREAD_Y + 6, height: drop },
                      ]}
                    />
                    <Animated.View
                      entering={arrive.delay(i * STAGGER_STEP)}
                      style={[
                        styles.look,
                        {
                          start: middle - LOOK_WIDTH / 2,
                          top: THREAD_Y + 6 + drop,
                          transform: [{ scale }],
                        },
                      ]}
                    >
                      <MiniLook items={piecesOf(d.look)} headers={headers} />
                    </Animated.View>
                  </>
                )}
              </View>
            );
          })}
      </View>
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    paddingHorizontal: 20,
    gap: 6,
  },
  caps: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  hand: {
    fontFamily: fonts.hand,
    fontSize: 23,
    lineHeight: 29,
    color: colors.text,
    textAlign: 'left',
  },
  week: {
    marginTop: 4,
  },
  thread: {
    position: 'absolute',
    top: THREAD_Y - 0.65,
    height: 1.3,
    backgroundColor: colors.text,
  },
  dayName: {
    position: 'absolute',
    top: 0,
    width: 40,
    textAlign: 'center',
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
  },
  bead: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.text,
  },
  // A day without a look: dashed, as the days still to come on the look of the day.
  beadEmpty: {
    backgroundColor: colors.background,
    borderWidth: 1.3,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
  },
  string: {
    position: 'absolute',
    width: 1.3,
    backgroundColor: colors.text,
  },
  // Shrinks from its top, where its string holds it.
  look: {
    position: 'absolute',
    width: LOOK_WIDTH,
    height: LOOK_HEIGHT,
    transformOrigin: 'top',
  },
});
