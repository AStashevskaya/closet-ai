import type { Outfit, TodayWeek } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, maison } from '@/components/maison';
import { OutfitMobile } from '@/components/outfit-mobile';
import { anotherToday, getToday, reactToOutfit, strikePiece } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { arrive, durations } from '@/motion';
import { colors, fonts } from '@/theme';

type Day = TodayWeek['days'][number];

// A temperature as the week shows it: +8°, 0°, −3° (a real minus).
export const degrees = (t: number) => `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}°`;

// What the day asks of clothes, for the line by hand under the look (the server's rules read it
// the same way: server/src/modules/today/daily-look.ts, needOf).
function adviceOf(day: Day | undefined) {
  if (!day) return null;
  if (day.sky === 'snow') return 'snow';
  if (day.sky === 'rain' || day.sky === 'storm' || day.wet >= 60) return 'wet';
  if (day.max < 12) return 'cold';
  if (day.max >= 22) return 'hot';
  return null;
}

// The look of the day, at the top of Style it (decided 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-today`, C with A inside): her week as seven beads on a
// thread with each day's temperature (worn days solid, today the cherry bead, days to come dashed),
// and today's look under it on powder blue, something new each morning, until she says she wore it.
// Built by rules on the server, from her closet, for the day's weather; no model, no cost.
export function TodayCard({ headers }: { headers: Record<string, string> | undefined }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [today, setToday] = useState<TodayWeek | null>(null);
  const [busy, setBusy] = useState(false);
  // Only the newest answer counts: an older one arriving late would undo a tap.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const read = ++latest.current;
    try {
      const answer = await getToday(lang);
      if (read === latest.current) setToday(answer);
    } catch {
      // Style it carries on without its top: the card is a bonus, never in the way.
    }
  }, [lang]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!today) return null;
  const look = today.look;
  const day = today.days.find((d) => d.date === today.today);
  const wornToday = (look?.woreCount ?? 0) > 0 || day?.wore === true;
  const weekday = (date: string, style: 'short' | 'long') =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: style,
      timeZone: 'UTC',
    });

  const setLook = (change: (o: Outfit) => Outfit) =>
    setToday((current) => (current?.look ? { ...current, look: change(current.look) } : current));

  async function wore() {
    if (!look || busy) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    ++latest.current;
    setLook((o) => ({ ...o, woreCount: o.woreCount + 1 }));
    try {
      await reactToOutfit(look.id, 'wore');
      void load();
    } catch {
      setLook((o) => ({ ...o, woreCount: Math.max(0, o.woreCount - 1) }));
    }
  }

  async function another() {
    if (!today || busy) return;
    setBusy(true);
    const read = ++latest.current;
    try {
      const answer = await anotherToday(lang, today.shown);
      if (read === latest.current) setToday(answer);
    } catch {
      // Keeps today's look; she can tap again.
    } finally {
      setBusy(false);
    }
  }

  function strike(pieceId: string, struck: boolean) {
    if (!look) return;
    void Haptics.selectionAsync();
    const set = (value: boolean) =>
      setLook((o) => ({
        ...o,
        pieces: o.pieces.map((p) => (p.id === pieceId ? { ...p, struck: value } : p)),
      }));
    set(struck);
    strikePiece(look.id, pieceId, struck).catch(() => set(!struck));
  }

  const advice = adviceOf(day);
  return (
    <Animated.View entering={arrive} style={styles.card} testID="today-card">
      {today.days.length > 0 && (
        <View
          style={styles.week}
          accessible
          accessibilityLabel={t('today.weekLabel', {
            days: today.days
              .map(
                (d) =>
                  `${weekday(d.date, 'long')} ${degrees(d.max)}${d.wore ? `, ${t('today.worn')}` : ''}`,
              )
              .join('; '),
          })}
        >
          <View style={styles.weekThread} />
          {today.days.map((d) => {
            const isToday = d.date === today.today;
            const past = today.today !== null && d.date < today.today;
            return (
              <View key={d.date} style={styles.day}>
                <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
                  {weekday(d.date, 'short')}
                </Text>
                <View
                  style={[
                    styles.bead,
                    d.wore && styles.beadWorn,
                    isToday && !d.wore && styles.beadToday,
                    !past && !isToday && styles.beadAhead,
                  ]}
                />
                <Text style={styles.temp}>{degrees(d.max)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {today.status === 'no-city' ? (
        <View style={styles.ask}>
          <Text style={styles.hand}>{t('today.noCityHand')}</Text>
          <Text style={maison.body}>{t('today.noCity')}</Text>
          <Button
            kind="outline"
            label={t('today.setCity')}
            onPress={() => router.push('/profile-details')}
          />
        </View>
      ) : today.status === 'not-found' ? (
        <Text style={[maison.note, styles.status]}>{t('today.notFound')}</Text>
      ) : null}

      {today.missing.length > 0 ? (
        <View style={styles.ask}>
          <Text style={styles.hand}>{t('today.soon')}</Text>
          <Text style={maison.body}>
            {t('today.missing', {
              what: today.missing.map((m) => t(`today.kinds.${m}`)).join(', '),
            })}
          </Text>
          <Button
            kind="outline"
            label={t('today.add')}
            onPress={() =>
              router.push({ pathname: '/add-item', params: { category: today.missing[0]! } })
            }
          />
        </View>
      ) : look ? (
        // On blue while it's new today; once worn, the blue goes and the line says so.
        <View
          style={[
            styles.look,
            !wornToday && styles.lookNew,
            { transitionProperty: 'backgroundColor', transitionDuration: durations.settle },
          ]}
        >
          {day && (
            <Text style={styles.headline}>
              <Text style={styles.degrees}>{degrees(day.max)}</Text>
              {'  '}
              {t(`today.sky.${day.sky}`)}
            </Text>
          )}
          <Text style={styles.caps}>{t('today.title')}</Text>
          <OutfitMobile
            pieces={look.pieces.flatMap((p) =>
              p.item
                ? [
                    {
                      ...p.item,
                      struck: p.struck,
                      onStrike: wornToday ? undefined : () => strike(p.id, !p.struck),
                      strikeLabel: t(p.struck ? 'wearWith.tieBack' : 'wearWith.cut', {
                        name: p.item.name,
                      }),
                    },
                  ]
                : [],
            )}
            headers={headers}
            caption={wornToday ? t('today.woreNote') : advice ? t(`today.advice.${advice}`) : ''}
          />
          <View style={styles.buttons}>
            {wornToday ? null : (
              <>
                <Button
                  kind="bright"
                  label={t('today.wore')}
                  onPress={wore}
                  style={styles.button}
                />
                {today.more && (
                  <Button
                    kind="outline"
                    label={t('today.another')}
                    onPress={another}
                    busy={busy}
                    style={styles.button}
                  />
                )}
              </>
            )}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    gap: 6,
  },
  week: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  // The thread the week's beads are on, through their middles.
  weekThread: {
    position: 'absolute',
    start: 34,
    end: 34,
    top: 27,
    height: 1.2,
    backgroundColor: colors.text,
  },
  day: {
    width: 40,
    alignItems: 'center',
    gap: 6,
  },
  dayName: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.textMuted,
  },
  dayNameToday: {
    fontFamily: fonts.bodySemiBold,
    color: colors.text,
  },
  bead: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.background,
  },
  beadWorn: {
    backgroundColor: colors.text,
  },
  beadToday: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginVertical: -2,
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  beadAhead: {
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
  },
  temp: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.text,
  },
  status: {
    paddingHorizontal: 20,
  },
  ask: {
    marginHorizontal: 20,
    marginTop: 8,
    padding: 16,
    gap: 10,
    borderWidth: 1.2,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
  },
  hand: {
    fontFamily: fonts.hand,
    fontSize: 20,
    lineHeight: 26,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  look: {
    marginTop: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 8,
    backgroundColor: colors.background,
  },
  // Something new arriving: today's look, until she wore it (docs/design.md, powder blue).
  lookNew: {
    backgroundColor: colors.ground,
  },
  headline: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  degrees: {
    fontFamily: fonts.displayLight,
    fontSize: 46,
    color: colors.text,
  },
  caps: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 18,
  },
});
