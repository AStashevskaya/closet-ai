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
// She said "not now" to the offer: it isn't made again on this phone until someone signs out.
const DECLINED_KEY = 'morning-declined';

// A temperature as the week shows it: +8°, 0°, −3° (a real minus).
export const degrees = (t: number) => `${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}°`;
// In a Hebrew sentence the sign would jump to the number's other side: held left-to-right.
const isolated = (text: string) => `\u2066${text}\u2069`;

// on: notes are scheduled; ask: the card may offer them; off: she said no, here or in Settings.
export type MorningState = 'on' | 'ask' | 'off';

export async function morningState(): Promise<MorningState> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'on';
  if (status === 'denied' || !canAskAgain) return 'off';
  return (await SecureStore.getItemAsync(DECLINED_KEY)) ? 'off' : 'ask';
}

// Android 13+ only asks for the permission once a channel exists, so the channel comes first.
async function channel() {
  if (Platform.OS !== 'android') return;
  // Default importance: a note, not an alarm.
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: i18n.t('today.morning.channel'),
    importance: AndroidImportance.DEFAULT,
  });
}

export async function turnOnMornings() {
  await channel();
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

// Signing out or deleting the account: her mornings, with her city's weather, go with her, and
// whoever signs in next on this phone is asked afresh.
export async function cancelMornings() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((note) => note.identifier.startsWith(PREFIX))
      .map((note) => Notifications.cancelScheduledNotificationAsync(note.identifier)),
  );
  await SecureStore.deleteItemAsync(DECLINED_KEY);
}

export async function declineMornings() {
  await SecureStore.setItemAsync(DECLINED_KEY, '1');
}

// The phone's own date for `at`, as the week's days are written (YYYY-MM-DD).
const localDate = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

// One run at a time: two reads of the card at once would interleave their cancels and schedules.
let running: Promise<void> = Promise.resolve();

// Keeps the next DAYS_AHEAD mornings at 8:00 on the phone's clock (today's too, if it's still
// before 8), each with its day's weather when the week has it. A note with the same id replaces
// the one there, so nothing is cancelled first (an app killed between the two would leave her
// none); only mornings outside the window are. The times are absolute: after flying to another
// time zone they stay at 8 at home until she next opens the app.
export function scheduleMornings(days: Day[], now = new Date()) {
  running = running.then(() => schedule(days, now)).catch(() => {});
  return running;
}

async function schedule(days: Day[], now: Date) {
  const t = i18n.t.bind(i18n);
  await channel();
  const wanted = new Map<string, Date>();
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const at = new Date(now);
    at.setDate(now.getDate() + i);
    at.setHours(HOUR, 0, 0, 0);
    if (at > now && wanted.size < DAYS_AHEAD) wanted.set(`${PREFIX}${localDate(at)}`, at);
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((note) => note.identifier.startsWith(PREFIX) && !wanted.has(note.identifier))
      .map((note) => Notifications.cancelScheduledNotificationAsync(note.identifier)),
  );
  for (const [identifier, at] of wanted) {
    const day = days.find((d) => d.date === identifier.slice(PREFIX.length));
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: t('today.morning.title'),
        body: day
          ? t('today.morning.weather', {
              degrees: i18n.language === 'he' ? isolated(degrees(day.max)) : degrees(day.max),
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
