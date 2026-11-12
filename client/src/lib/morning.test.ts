import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import i18n from '@/i18n';

import { declineMornings, morningState, scheduleMornings } from './morning';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const notes = jest.mocked(Notifications);
const store = jest.mocked(SecureStore);

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('ru');
});

describe('morningState', () => {
  const permission = (status: string, canAskAgain = true) =>
    notes.getPermissionsAsync.mockResolvedValue({ status, canAskAgain } as never);

  test('on when allowed, off when refused, asks only if she never said no', async () => {
    permission('granted');
    expect(await morningState()).toBe('on');
    permission('denied', false);
    expect(await morningState()).toBe('off');

    permission('undetermined');
    store.getItemAsync.mockResolvedValue(null);
    expect(await morningState()).toBe('ask');
    await declineMornings();
    expect(store.setItemAsync).toHaveBeenCalledWith('morning-declined', '1');
    store.getItemAsync.mockResolvedValue('1');
    expect(await morningState()).toBe('off');
  });
});

describe('scheduleMornings', () => {
  test('replaces the old mornings with the next ones at 8, each with its weather', async () => {
    notes.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'morning-2026-11-12' },
      { identifier: 'something-else' },
    ] as never);
    // Thursday 2026-11-12, 07:30 on the phone: today's 8:00 is still ahead.
    const now = new Date(2026, 10, 12, 7, 30);
    await scheduleMornings(
      [
        { date: '2026-11-12', max: 4, min: 0, sky: 'rain', wet: 80, wore: false },
        { date: '2026-11-13', max: -3, min: -6, sky: 'snow', wet: 40, wore: false },
      ],
      now,
    );

    expect(notes.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notes.cancelScheduledNotificationAsync).toHaveBeenCalledWith('morning-2026-11-12');
    const calls = notes.scheduleNotificationAsync.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(8);
    expect(calls[0]).toMatchObject({
      identifier: 'morning-2026-11-12',
      content: { title: 'Образ дня готов', body: 'Сегодня +4°, дождь. Посмотри, что надеть.' },
    });
    expect(calls[1]!.content.body).toBe('Сегодня −3°, снег. Посмотри, что надеть.');
    // Past the week the app knows: no weather, still the note.
    expect(calls[7]).toMatchObject({
      identifier: 'morning-2026-11-19',
      content: { body: 'Посмотри, что надеть сегодня.', data: { url: '/style' } },
    });
    const first = (calls[0]!.trigger as { date: Date }).date;
    expect([first.getHours(), first.getMinutes()]).toEqual([8, 0]);
  });

  test('after 8 the first morning is tomorrow', async () => {
    notes.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await scheduleMornings([], new Date(2026, 10, 12, 9, 0));
    const ids = notes.scheduleNotificationAsync.mock.calls.map(([request]) => request.identifier);
    expect(ids[0]).toBe('morning-2026-11-13');
    expect(ids).toHaveLength(7);
  });
});
