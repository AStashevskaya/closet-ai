import type { Wish } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { answerWish, createItem, getWearWith, listWishes } from '@/lib/api';

import { Wishes } from '.';

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

const wish = (id: string, name: string, due: boolean): Wish => ({
  id,
  requestId: `req-${id}`,
  name,
  photoUrl: `/api/wear-with/req-${id}/photo`,
  cutoutUrl: null,
  call: 'buy',
  createdAt: '2026-10-15T10:00:00.000Z',
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
    // Only the due one asks.
    expect(screen.getAllByText('Still want it?')).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Yes' }));
    expect(answerWish).toHaveBeenCalledWith(skirt.id, 'still');
    expect(screen.queryByText('Still want it?')).toBeNull();
  });

  test('lets a wish go, or adds a bought one to the closet first', async () => {
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
    expect(answerWish).toHaveBeenCalledWith(skirt.id, 'bought');
    expect(screen.queryByText('Red knit mini')).toBeNull();
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
