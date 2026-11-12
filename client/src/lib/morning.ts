import type { TodayWeek } from '@closet-ai/shared';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import i18n from '@/i18n';

// The morning note for the look of the day (decided 2026-11-12, variant A): the phone schedules it
// itself, for the next mornings, each with that day's weather from the week the app last read.
// Nothing goes to the server: no push token, no job. If she stops opening the app, the notes run
// out after a week, which is fair: we don't keep calling someone who has left.

type Day = TodayWeek['days'][number];

const HOUR = 8;
const DAYS_AHEAD = 7;
const PREFIX = 'morning-';
const CHANNEL = 'morning';
// She said "not now" to the offer: it isn't made again (she can still turn it on in Settings).
const DECLINED_KEY = 'morning-declined';

// A temperature as the week shows it: +8°, 0°, −3° (a real minus).
export const degrees = (t: number) => `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}°`;

// on: notes are scheduled; ask: the card may offer them; off: she said no, here or in Settings.
export type MorningState = 'on' | 'ask' | 'off';

export async function morningState(): Promise<MorningState> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'on';
  if (status === 'denied' || !canAskAgain) return 'off';
  return (await SecureStore.getItemAsync(DECLINED_KEY)) ? 'off' : 'ask';
}

export async function turnOnMornings() {
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

export async function declineMornings() {
  await SecureStore.setItemAsync(DECLINED_KEY, '1');
}

// The phone's own date for `at`, as the week's days are written (YYYY-MM-DD).
const localDate = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

// Replaces the scheduled mornings with the next DAYS_AHEAD ones at 8:00 on the phone's clock
// (today's too, if it's still before 8), each with its day's weather when the week has it.
export async function scheduleMornings(days: Day[], now = new Date()) {
  const t = i18n.t.bind(i18n);
  if (Platform.OS === 'android') {
    // Default importance: a note, not an alarm.
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: t('today.morning.channel'),
      importance: AndroidImportance.DEFAULT,
    });
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((note) => note.identifier.startsWith(PREFIX))
      .map((note) => Notifications.cancelScheduledNotificationAsync(note.identifier)),
  );
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const at = new Date(now);
    at.setDate(now.getDate() + i);
    at.setHours(HOUR, 0, 0, 0);
    if (at <= now) continue;
    const date = localDate(at);
    const day = days.find((d) => d.date === date);
    await Notifications.scheduleNotificationAsync({
      identifier: `${PREFIX}${date}`,
      content: {
        title: t('today.morning.title'),
        body: day
          ? t('today.morning.weather', {
              degrees: degrees(day.max),
              sky: t(`today.sky.${day.sky}`),
            })
          : t('today.morning.plain'),
        data: { url: '/style' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: CHANNEL,
      },
    });
  }
}
