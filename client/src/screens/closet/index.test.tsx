import type { Item } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { listItems } from '@/lib/api';

import { Closet } from '.';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    Link: ({ children }: { children: unknown }) => children,
    // Runs the callback once on mount, as if the tab just came into view.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
jest.mock('@/lib/api', () => ({
  listItems: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 'session=1' }),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

const list = jest.mocked(listItems);

const shirt: Item = {
  id: '6b1f7c3e-0000-4000-8000-000000000001',
  name: 'White linen shirt',
  category: 'top',
  colors: ['white'],
  seasons: [],
  photoUrl: '/api/items/6b1f7c3e-0000-4000-8000-000000000001/photo',
  createdAt: '2026-10-18T10:00:00.000Z',
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<Closet />', () => {
  test('shows the items with their category', async () => {
    list.mockResolvedValue([shirt]);
    await render(<Closet />);

    expect(await screen.findByText('White linen shirt')).toBeOnTheScreen();
    expect(screen.getByText('Top')).toBeOnTheScreen();
  });

  test('invites to add the first item when the closet is empty', async () => {
    list.mockResolvedValue([]);
    await render(<Closet />);

    expect(await screen.findByText(/Your closet is empty/)).toBeOnTheScreen();
    expect(screen.getByText('Add item')).toBeOnTheScreen();
  });

  test('offers to retry after a failed load', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([shirt]);
    await render(<Closet />);

    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('White linen shirt')).toBeOnTheScreen();
  });

  test('renders the title in Russian', async () => {
    list.mockResolvedValue([]);
    await i18n.changeLanguage('ru');
    await render(<Closet />);

    expect(await screen.findByText('Мой гардероб')).toBeOnTheScreen();
  });
});
