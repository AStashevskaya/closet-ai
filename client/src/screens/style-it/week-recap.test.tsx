import type { Item, WeekLooks } from '@closet-ai/shared';
import { render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { getWeekLooks } from '@/lib/api';

import { isRecapTime, WeekRecap } from './week-recap';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({
  getWeekLooks: jest.fn(),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const item = (n: number, name: string, category: Item['category']): Item => ({
  id: `6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a${String(n).padStart(2, '0')}`,
  name,
  category,
  colors: ['black'],
  seasons: [],
  photoUrl: `/api/items/${n}/photo`,
  photoStatus: 'ready',
  createdAt: '2026-11-01T10:00:00.000Z',
});
const look = (n: number, pieces: Item[]) =>
  ({
    id: `5f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a${String(n).padStart(2, '0')}`,
    caption: '',
    occasion: '',
    why: '',
    missing: null,
    opinion: null,
    reason: null,
    woreCount: 1,
    pieces: pieces.map((p, i) => ({
      id: `c5a86a64-8e30-44e8-b425-b396b5b281${n}${i}`,
      hero: false,
      struck: false,
      item: p,
      catalogItem: null,
    })),
  }) as unknown as NonNullable<WeekLooks['days'][number]['look']>;
const tee = item(1, 'Black tee', 'top');
const jeans = item(2, 'Jeans', 'bottom');
const skirt = item(3, 'Midi skirt', 'bottom');
const loafers = item(4, 'Loafers', 'shoes');
const dates = ['09', '10', '11', '12', '13', '14', '15'].map((d) => `2026-11-${d}`);
const week = (looks: (ReturnType<typeof look> | null)[]): WeekLooks => ({
  from: dates[0]!,
  to: dates[6]!,
  days: dates.map((date, i) => ({ date, look: looks[i] ?? null })),
});
// Sunday 2026-11-15, 18:00 on the phone.
const sunday = () => new Date(2026, 10, 15, 18, 0);

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

test('is told on Sunday evening only', () => {
  expect(isRecapTime(new Date(2026, 10, 15, 17, 0))).toBe(true);
  expect(isRecapTime(new Date(2026, 10, 15, 16, 59))).toBe(false);
  expect(isRecapTime(new Date(2026, 10, 14, 20, 0))).toBe(false);
});

test('hangs each worn day’s look under its bead, and says no look came twice', async () => {
  jest
    .mocked(getWeekLooks)
    .mockResolvedValue(
      week([look(1, [tee, jeans, loafers]), null, look(2, [tee, skirt, loafers])]),
    );
  await render(<WeekRecap headers={{ cookie: 'session=1' }} now={sunday} />);

  expect(
    await screen.findByRole('header', { name: '2 of 7 days — and not one look twice' }),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Your week · /)).toBeOnTheScreen();
});

test('the same look twice is just counted', async () => {
  jest.mocked(getWeekLooks).mockResolvedValue(week([look(1, [tee, jeans]), look(2, [jeans, tee])]));
  await render(<WeekRecap headers={undefined} now={sunday} />);

  expect(await screen.findByRole('header', { name: '2 of 7 days' })).toBeOnTheScreen();
});

test('nothing for a week she marked nothing in, or on another day', async () => {
  jest.mocked(getWeekLooks).mockResolvedValue(week([]));
  const view = await render(<WeekRecap headers={undefined} now={sunday} />);
  await waitFor(() => expect(getWeekLooks).toHaveBeenCalled());
  expect(screen.queryByTestId('week-recap')).not.toBeOnTheScreen();
  view.unmount();

  jest.mocked(getWeekLooks).mockClear();
  await render(<WeekRecap headers={undefined} now={() => new Date(2026, 10, 12, 18, 0)} />);
  expect(getWeekLooks).not.toHaveBeenCalled();
  expect(screen.queryByTestId('week-recap')).not.toBeOnTheScreen();
});
