import type { Wish } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { answerWish, createItem, getWearWith, listWishes } from '@/lib/api';

import { daysPassed, Wishes } from '.';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({
  listWishes: jest.fn(),
  answerWish: jest.fn(),
  getWearWith: jest.fn(),
  createItem: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const DAY = 24 * 60 * 60 * 1000;
const wish = (id: string, name: string, due: boolean): Wish => ({
  id,
  requestId: `req-${id}`,
  name,
  photoUrl: `/api/wear-with/req-${id}/photo`,
  cutoutUrl: null,
  call: 'buy',
  createdAt: '2026-10-15T10:00:00.000Z',
  // Due now, or four days into its week (three to go).
  askAt: new Date(Date.now() + (due ? -DAY : 3 * DAY - 60_000)).toISOString(),
  due,
});
const skirt = wish('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9b01', 'Red knit mini', true);
const tank = wish('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9b02', 'White ribbed tank', false);

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(listWishes).mockResolvedValue([skirt, tank]);
  jest.mocked(answerWish).mockResolvedValue();
});

describe('<Wishes />', () => {
  test('asks about the wishes that are due, and keeps one she still wants', async () => {
    await render(<Wishes />);
    expect(await screen.findByText('Red knit mini')).toBeOnTheScreen();
    // Only the due one asks, reminding her of the verdict; the other counts its week down.
    expect(screen.getAllByText('Still want it?')).toHaveLength(1);
    expect(screen.getByText('A week ago: “Buy it”')).toBeOnTheScreen();
    expect(screen.getByText('3 days to go')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Yes, a week more' }));
    expect(answerWish).toHaveBeenCalledWith(skirt.id, 'still');
    expect(screen.queryByText('Still want it?')).toBeNull();
    // Kept: a new week starts.
    expect(screen.getByText('7 days to go')).toBeOnTheScreen();
  });

  test('counts the days of the week gone', () => {
    const now = Date.parse('2026-10-29T12:00:00.000Z');
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(daysPassed(at(7 * DAY), now)).toBe(0);
    expect(daysPassed(at(3 * DAY - 1), now)).toBe(4);
    expect(daysPassed(at(-DAY), now)).toBe(7);
    // A week pushed further than seven days still shows the whole week left.
    expect(daysPassed(at(9 * DAY), now)).toBe(0);
  });

  test('adds a bought one to the closet', async () => {
    const addable = {
      name: 'Red knit mini',
      category: 'bottom' as const,
      colors: ['red' as const],
      seasons: [],
      photoKey: 'photos/u1/crop.webp',
    };
    jest.mocked(getWearWith).mockResolvedValue({ addable } as never);
    jest.mocked(createItem).mockResolvedValue({} as never);
    await render(<Wishes />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Bought it' }));

    expect(createItem).toHaveBeenCalledWith(addable);
    // Adding it to the closet lets the wish go on the server; nothing left to answer.
    expect(answerWish).not.toHaveBeenCalled();
    expect(screen.queryByText('Red knit mini')).toBeNull();
  });

  test('says so when the answer could not be saved, and keeps the question', async () => {
    jest.mocked(answerWish).mockRejectedValue(new Error('offline'));
    await render(<Wishes />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Not anymore' }));

    expect(await screen.findByText("Couldn't save the answer. Try again.")).toBeOnTheScreen();
    expect(screen.getByText('Still want it?')).toBeOnTheScreen();
  });

  test('opens the outfits of a wish', async () => {
    await render(<Wishes />);
    await fireEvent.press(await screen.findByRole('button', { name: 'White ribbed tank' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wear-with/[id]',
      params: { id: tank.requestId },
    });
  });

  test('explains the wishes when there are none', async () => {
    jest.mocked(listWishes).mockResolvedValue([]);
    await render(<Wishes />);
    expect(await screen.findByText(/In a week I'll ask/)).toBeOnTheScreen();
  });
});
