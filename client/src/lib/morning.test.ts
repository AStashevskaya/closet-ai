import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import i18n from '@/i18n';

import {
  cancelMornings,
  declineMornings,
  morningState,
  rememberMorning,
  scheduleMornings,
} from './morning';

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
  deleteItemAsync: jest.fn(),
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

    // Today's 8:00 is replaced in place, not cancelled first; other apps' notes are left alone.
    expect(notes.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    const calls = notes.scheduleNotificationAsync.mock.calls.map(([request]) => request);
    expect(calls).toHaveLength(7);
    expect(calls[0]).toMatchObject({
      identifier: 'morning-2026-11-12',
      content: { title: 'Образ дня готов', body: 'Сегодня +4°, дождь. Посмотри, что надеть.' },
    });
    expect(calls[1]!.content.body).toBe('Сегодня −3°, снег. Посмотри, что надеть.');
    // Past the week the app knows: no weather, still the note.
    expect(calls[6]).toMatchObject({
      identifier: 'morning-2026-11-18',
      content: { body: 'Посмотри, что надеть сегодня.', data: { url: '/style' } },
    });
    const first = (calls[0]!.trigger as { date: Date }).date;
    expect([first.getHours(), first.getMinutes()]).toEqual([8, 0]);
  });

  test('after 8 the first morning is tomorrow, and a morning gone by is cancelled', async () => {
    notes.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'morning-2026-11-12' },
    ] as never);
    await scheduleMornings([], new Date(2026, 10, 12, 9, 0));
    const ids = notes.scheduleNotificationAsync.mock.calls.map(([request]) => request.identifier);
    expect(ids[0]).toBe('morning-2026-11-13');
    expect(ids).toHaveLength(7);
    expect(notes.cancelScheduledNotificationAsync).toHaveBeenCalledWith('morning-2026-11-12');
  });

  test('signing out takes her mornings and her "not now" with her', async () => {
    notes.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'morning-2026-11-13' },
      { identifier: 'someone-else' },
    ] as never);
    await cancelMornings();
    expect(notes.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notes.cancelScheduledNotificationAsync).toHaveBeenCalledWith('morning-2026-11-13');
    expect(store.deleteItemAsync).toHaveBeenCalledWith('morning-declined');
    expect(store.deleteItemAsync).toHaveBeenCalledWith('morning-remember');
    expect(store.deleteItemAsync).toHaveBeenCalledWith('morning-days');
    // Whoever signs in next on this phone sees her own week's find.
    expect(store.deleteItemAsync).toHaveBeenCalledWith('found-shown');
  });
});

describe('rememberMorning', () => {
  test('the chosen day’s note brings the piece up by name, with that day’s weather', async () => {
    let kept: string | null = null;
    store.getItemAsync.mockImplementation(async (key) =>
      key === 'morning-remember' ? kept : null,
    );
    store.setItemAsync.mockImplementation(async (key, value) => {
      if (key === 'morning-remember') kept = value;
    });
    notes.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true } as never);
    notes.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    const now = new Date(2026, 10, 12, 9, 0);
    // The week the card read earlier keeps its weather for the notes scheduled from the closet.
    await scheduleMornings(
      [{ date: '2026-11-13', max: 3, min: 0, sky: 'rain', wet: 80, wore: false }],
      now,
    );
    notes.scheduleNotificationAsync.mockClear();

    await rememberMorning('2026-11-13', 'Красный кардиган', now);

    const tomorrow = notes.scheduleNotificationAsync.mock.calls
      .map(([request]) => request)
      .find((request) => request.identifier === 'morning-2026-11-13');
    expect(tomorrow?.content.body).toBe('Красный кардиган — помнишь? Сегодня +3°, дождь.');
    const after = notes.scheduleNotificationAsync.mock.calls
      .map(([request]) => request)
      .find((request) => request.identifier === 'morning-2026-11-14');
    expect(after?.content.body).toBe('Посмотри, что надеть сегодня.');
  });

  test('after a cold start the notes keep the weather the phone kept', async () => {
    // Signing out empties the week held in memory, as a fresh start of the app would.
    notes.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await cancelMornings();
    const phone = new Map<string, string>([
      [
        'morning-days',
        JSON.stringify([
          { date: '2026-11-14', max: -2, min: -5, sky: 'snow', wet: 60, wore: false },
        ]),
      ],
    ]);
    store.getItemAsync.mockImplementation(async (key) => phone.get(key) ?? null);
    store.setItemAsync.mockImplementation(async (key, value) => {
      phone.set(key, value);
    });
    notes.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true } as never);
    notes.scheduleNotificationAsync.mockClear();

    await rememberMorning('2026-11-13', 'Красный кардиган', new Date(2026, 10, 12, 9, 0));

    const body = (id: string) =>
      notes.scheduleNotificationAsync.mock.calls
        .map(([request]) => request)
        .find((request) => request.identifier === id)?.content.body;
    expect(body('morning-2026-11-13')).toBe(
      'Красный кардиган — помнишь? Образ на сегодня ты выбрала сама.',
    );
    expect(body('morning-2026-11-14')).toContain('−2°');
  });
});
