import type { Outfit, WeekLooks } from '@closet-ai/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
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

// The week's recap on Sunday evening (decided 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-hooks`, A): the week's thread, as on the look of the day,
// with the look she wore hanging under each day's bead and a dashed bead for a day without; above
// it, by hand, how many days, and whether no look came twice. A reward for the habit, no new sign.
// Nothing at all for a week she marked nothing in. Sharing it comes later.
// The clock, kept stable for the focus effect (a new function each render would re-run it).
const clock = () => new Date();

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
        .then((answer) => current && setWeek(answer))
        // A bonus on top of Style it: if it can't be read, it just isn't there.
        .catch(() => current && setWeek(null));
      return () => {
        current = false;
      };
    }, [lang, now]),
  );

  const worn = week?.days.filter((d) => d.look) ?? [];
  if (!week || worn.length === 0) return null;

  const piecesOf = (look: Outfit) => look.pieces.flatMap((p) => (p.item ? [p.item] : []));
  // The same pieces on two days is the same look.
  const distinct = new Set(
    worn.map((d) =>
      piecesOf(d.look!)
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

  return (
    <Animated.View entering={arrive} style={styles.card} testID="week-recap">
      <Text style={styles.caps}>
        {t('today.recap.title', { range: `${dayMonth(week.from)} – ${dayMonth(week.to)}` })}
      </Text>
      <Text style={styles.hand} accessibilityRole="header">
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
            const pieces = d.look ? piecesOf(d.look) : [];
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
                    !d.look && styles.beadEmpty,
                    { start: middle - 6, top: THREAD_Y - 6 },
                  ]}
                />
                {d.look && (
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
                        { start: middle - LOOK_WIDTH / 2, top: THREAD_Y + 6 + drop },
                      ]}
                    >
                      <MiniLook look={d.look} headers={headers} />
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

// A worn look, small: the top or dress (a coat behind it), the bottom under it, the shoes at the
// foot. Bags and other accessories are left out at this size.
function MiniLook({
  look,
  headers,
}: {
  look: Outfit;
  headers: Record<string, string> | undefined;
}) {
  const items = look.pieces.flatMap((p) => (p.item ? [p.item] : []));
  const of = (category: string) => items.find((item) => item.category === category);
  const dress = of('dress');
  const top = of('top');
  const bottom = of('bottom');
  const shoes = of('shoes');
  const coat = of('outerwear');
  return (
    <View style={styles.mini}>
      {coat && <BarePiece item={coat} headers={headers} style={styles.miniCoat} />}
      {dress ? (
        <BarePiece item={dress} headers={headers} style={styles.miniDress} />
      ) : (
        <>
          {top && <BarePiece item={top} headers={headers} style={styles.miniTop} />}
          {bottom && <BarePiece item={bottom} headers={headers} style={styles.miniBottom} />}
        </>
      )}
      {shoes && <BarePiece item={shoes} headers={headers} style={styles.miniShoes} />}
    </View>
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
  look: {
    position: 'absolute',
    width: LOOK_WIDTH,
    height: LOOK_HEIGHT,
  },
  mini: {
    width: LOOK_WIDTH,
    height: LOOK_HEIGHT,
  },
  miniCoat: {
    position: 'absolute',
    start: 0,
    top: 0,
    width: 52,
    height: 70,
  },
  miniTop: {
    position: 'absolute',
    start: 12,
    top: 0,
    width: 54,
    height: 54,
  },
  miniDress: {
    position: 'absolute',
    start: 10,
    top: 0,
    width: 56,
    height: 92,
  },
  miniBottom: {
    position: 'absolute',
    start: 16,
    top: 44,
    width: 48,
    height: 52,
  },
  miniShoes: {
    position: 'absolute',
    start: 18,
    top: 96,
    width: 36,
    height: 22,
  },
});
