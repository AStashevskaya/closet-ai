import type { Item, TodayWeek } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { anotherToday, getToday, reactToOutfit } from '@/lib/api';
import {
  declineMornings,
  degrees,
  morningState,
  scheduleMornings,
  turnOnMornings,
} from '@/lib/morning';

import { TodayCard } from './today-card';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({
  getToday: jest.fn(),
  anotherToday: jest.fn(),
  reactToOutfit: jest.fn(),
  strikePiece: jest.fn(),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

jest.mock('@/lib/morning', () => ({
  ...jest.requireActual<typeof import('@/lib/morning')>('@/lib/morning'),
  morningState: jest.fn().mockResolvedValue('off'),
  turnOnMornings: jest.fn(),
  declineMornings: jest.fn().mockResolvedValue(undefined),
  scheduleMornings: jest.fn().mockResolvedValue(undefined),
}));

const item = (id: string, name: string, category: Item['category']): Item => ({
  id,
  name,
  category,
  colors: ['black'],
  seasons: [],
  photoUrl: `/api/items/${id}/photo`,
  photoStatus: 'ready',
  createdAt: '2026-11-01T10:00:00.000Z',
});
const days = [
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-14',
  '2026-11-15',
];
const look = {
  id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a91',
  caption: '',
  occasion: '',
  why: '',
  missing: null,
  opinion: null,
  reason: null,
  woreCount: 0,
  pieces: [
    {
      id: 'c5a86a64-8e30-44e8-b425-b396b5b28124',
      struck: false,
      hero: false,
      item: item('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a01', 'Trench', 'outerwear'),
      catalogItem: null,
    },
    {
      id: 'c5a86a64-8e30-44e8-b425-b396b5b28125',
      struck: false,
      hero: false,
      item: item('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a02', 'Jeans', 'bottom'),
      catalogItem: null,
    },
  ],
} as unknown as NonNullable<TodayWeek['look']>;
const week = (over: Partial<TodayWeek> = {}): TodayWeek => ({
  status: 'ok',
  place: 'Minsk',
  today: '2026-11-12',
  days: days.map((date, i) => ({
    date,
    max: 8 - i,
    min: 0,
    sky: i === 3 ? 'rain' : 'clouds',
    wet: i === 3 ? 80 : 0,
    wore: i === 1,
  })),
  look,
  missing: [],
  shown: 1,
  more: true,
  ...over,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<TodayCard />', () => {
  test('shows the week on its thread and today’s look on blue, with the day’s weather', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    await render(<TodayCard headers={{}} />);
    expect(await screen.findByText('Your look for today')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(/^Your week: Monday \+8°; Tuesday \+7°, worn; /),
    ).toBeOnTheScreen();
    expect(screen.getByText('take an umbrella')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Another' })).toBeOnTheScreen();
  });

  test('“I wore it” marks the day and the blue goes', async () => {
    jest
      .mocked(getToday)
      .mockResolvedValueOnce(week())
      .mockResolvedValue(week({ look: { ...look, woreCount: 1 } }));
    jest.mocked(reactToOutfit).mockResolvedValue();
    await render(<TodayCard headers={{}} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'I wore it' }));
    expect(reactToOutfit).toHaveBeenCalledWith(look.id, 'wore');
    expect(await screen.findByText("worn — I'll remember")).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Another' })).toBeNull();
  });

  test('“Another” sends how many looks it showed, and hides when none is left', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    jest.mocked(anotherToday).mockResolvedValue(week({ shown: 1, more: false }));
    await render(<TodayCard headers={{}} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Another' }));
    expect(anotherToday).toHaveBeenCalledWith('en', 1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Another' })).toBeNull());
  });

  test('asks for a city, and says what the closet lacks', async () => {
    jest.mocked(getToday).mockResolvedValue(
      week({
        status: 'no-city',
        place: null,
        today: null,
        days: [],
        look: null,
        missing: ['shoes'],
        shown: 0,
      }),
    );
    await render(<TodayCard headers={{}} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add my city' }));
    expect(mockPush).toHaveBeenCalledWith('/profile-details');
    expect(
      screen.getByText('To put a look together every day I need shoes in your closet.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add a piece' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/add-item', params: { category: 'shoes' } });
  });

  test('waits with its week in place, and goes quietly when it can’t load', async () => {
    let fail: (cause: Error) => void = () => {};
    jest.mocked(getToday).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    await render(<TodayCard headers={{}} />);
    expect(screen.getByTestId('today-waiting', { includeHiddenElements: true })).toBeOnTheScreen();
    fail(new Error('offline'));
    await waitFor(() =>
      expect(screen.queryByTestId('today-waiting', { includeHiddenElements: true })).toBeNull(),
    );
    expect(screen.queryByTestId('today-card')).toBeNull();
  });

  test('“I wore it” goes back when the server doesn’t take it', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    jest.mocked(reactToOutfit).mockRejectedValue(new Error('offline'));
    await render(<TodayCard headers={{}} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'I wore it' }));
    expect(await screen.findByRole('button', { name: 'I wore it' })).toBeOnTheScreen();
    expect(screen.queryByText("worn — I'll remember")).toBeNull();
  });
});

describe('the morning note', () => {
  test('is offered under her first look, and scheduled with the week once she says yes', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    jest.mocked(morningState).mockResolvedValue('ask');
    jest.mocked(turnOnMornings).mockResolvedValue(true);
    await render(<TodayCard headers={undefined} />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Send it' }));
    await waitFor(() => expect(scheduleMornings).toHaveBeenCalledWith(week().days));
    expect(screen.queryByText('send you the look in the morning, at 8?')).not.toBeOnTheScreen();
  });

  test('"Not now" is remembered and the offer goes', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    jest.mocked(morningState).mockResolvedValue('ask');
    await render(<TodayCard headers={undefined} />);

    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(declineMornings).toHaveBeenCalled();
    expect(turnOnMornings).not.toHaveBeenCalled();
    expect(screen.queryByText('send you the look in the morning, at 8?')).not.toBeOnTheScreen();
  });

  test('once on, each visit schedules the next mornings again', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    jest.mocked(morningState).mockResolvedValue('on');
    await render(<TodayCard headers={undefined} />);

    await waitFor(() => expect(scheduleMornings).toHaveBeenCalledWith(week().days));
    expect(screen.queryByText('send you the look in the morning, at 8?')).not.toBeOnTheScreen();
  });

  test('turned off, nothing is scheduled and nothing offered', async () => {
    jest.mocked(getToday).mockResolvedValue(week());
    jest.mocked(morningState).mockResolvedValue('off');
    await render(<TodayCard headers={undefined} />);

    expect(await screen.findByTestId('today-card')).toBeOnTheScreen();
    await waitFor(() => expect(morningState).toHaveBeenCalled());
    expect(scheduleMornings).not.toHaveBeenCalled();
    expect(screen.queryByText('send you the look in the morning, at 8?')).not.toBeOnTheScreen();
  });
});

test('degrees uses a real minus and a plus', () => {
  expect([8, 0, -3].map(degrees)).toEqual(['+8°', '0°', '−3°']);
});
