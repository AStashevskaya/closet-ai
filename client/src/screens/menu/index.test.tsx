import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import i18n from '@/i18n';

import { getStyle, listInspiration } from '@/lib/api';
import { setLanguage } from '@/lib/language';

import { Menu } from '.';

// The `mock` prefix lets the jest.mock factory below use it.
const mockNavigate = jest.fn();
const mockPush = jest.fn();

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, push: mockPush }),
  // As if the tab had just come into view.
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/lib/api', () => ({
  getUsage: jest.fn().mockResolvedValue({
    want: { used: 2, limit: 5, resetsAt: '2026-11-01T00:00:00.000Z' },
    look: { used: 0, limit: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
    wear_with: { used: 1, limit: 30, resetsAt: '2026-10-22T00:00:00.000Z' },
  }),
  countDueWishes: jest.fn().mockResolvedValue(1),
  listItems: jest.fn().mockResolvedValue([
    { id: 'b', name: 'Tweed blazer', createdAt: '2026-10-12T10:00:00.000Z' },
    { id: 'a', name: 'White tank', createdAt: '2026-10-02T10:00:00.000Z' },
  ]),
  listInspiration: jest
    .fn()
    .mockResolvedValue([{ key: 'k', url: '/u', createdAt: '2026-10-20T10:00:00.000Z' }]),
  listStyled: jest.fn().mockResolvedValue([
    {
      id: 'r2',
      createdAt: '2026-10-27T10:00:00.000Z',
      mood: null,
      name: 'Pink boots',
      photoUrl: null,
      cutoutUrl: null,
    },
    {
      id: 'r1',
      createdAt: '2026-10-21T10:00:00.000Z',
      mood: null,
      name: 'Satin skirt',
      photoUrl: null,
      cutoutUrl: null,
    },
  ]),
  sessionHeaders: jest.fn().mockResolvedValue({}),
  getStyle: jest.fn().mockResolvedValue({
    summary: 'High-low with a wink.',
    writtenAt: '2026-10-21T12:00:00.000Z',
    updating: false,
    suggest: null,
  }),
}));
jest.mock('@/lib/language', () => ({ setLanguage: jest.fn() }));
jest.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: 'user-1', name: 'Anna', createdAt: new Date('2026-10-02T09:00:00Z') } },
    }),
    signOut: jest.fn(),
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<Menu />', () => {
  test("shows the signed-in user's name", async () => {
    await render(<Menu />);
    expect(screen.getByText('Anna')).toBeOnTheScreen();
  });

  test('opens the closet tab and the want screen', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('My closet'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
    await fireEvent.press(screen.getByText('Recreate the look'));
    expect(mockNavigate).toHaveBeenCalledWith('/want-can');
  });

  test('shows only the sections the app has', async () => {
    await render(<Menu />);
    // My profile, the closet, Style it, Recreate the look, Wishes and the Edit; nothing "soon".
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    expect(screen.queryByText('soon')).toBeNull();
  });

  test('shows how many wishes wait for an answer', async () => {
    await render(<Menu />);
    expect(await screen.findByText('1 to answer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Wishes'));
    expect(mockNavigate).toHaveBeenCalledWith('/wishes');
  });

  test('starts her thread with what is left of the limits today', async () => {
    await render(<Menu />);
    expect(await screen.findByText('1 / 30')).toBeOnTheScreen();
    expect(screen.getByText('“Recreate the look” screenshots this month: 2 / 5')).toBeOnTheScreen();
    expect(screen.getByText('Selfies this month: 0 / 3')).toBeOnTheScreen();
  });

  test('follows her thread: the last piece styled, the counts, the first piece', async () => {
    await render(<Menu />);
    expect(await screen.findByText('Pink boots')).toBeOnTheScreen();
    expect(screen.getByText('2 · 1 · 2')).toBeOnTheScreen();
    expect(screen.getByText('White tank')).toBeOnTheScreen();
    expect(screen.getByText('Joined October 2, 2026')).toBeOnTheScreen();
  });

  describe('report a problem', () => {
    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
    });

    test('opens a letter to support with the details to look into it', async () => {
      process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@closet.test';
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
      await render(<Menu />);
      await fireEvent.press(screen.getByText('Report a problem'));

      const url = decodeURIComponent(open.mock.lastCall![0]);
      expect(url).toMatch(/^mailto:help@closet\.test\?subject=Closet: a problem&body=/);
      expect(url).toContain('Account: user-1');
      expect(url).toContain('Language: en');
    });

    test('is hidden until a support address is set', async () => {
      await render(<Menu />);
      expect(screen.queryByText('Report a problem')).toBeNull();
    });
  });

  test('opens my profile, where the account can be signed out of or deleted', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('My profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile-details');
    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByText('Delete account')).toBeNull();
  });

  describe('language', () => {
    test('follows the phone until one is picked, and keeps the pick checked', async () => {
      await render(<Menu />);
      await fireEvent.press(screen.getByRole('button', { name: 'Language: As on my phone' }));
      expect(
        screen.getByRole('radio', { name: 'As on my phone', checked: true }),
      ).toBeOnTheScreen();

      await fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
      expect(setLanguage).toHaveBeenCalledWith('ru');
      expect(screen.getByRole('button', { name: 'Language: Русский' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Language: Русский' }));
      expect(screen.getByRole('radio', { name: 'Русский', checked: true })).toBeOnTheScreen();
    });

    test("goes back to what it was when the pick doesn't go through", async () => {
      jest.mocked(setLanguage).mockRejectedValueOnce(new Error('no keychain'));
      await render(<Menu />);
      await fireEvent.press(screen.getByRole('button', { name: 'Language: As on my phone' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
      expect(
        await screen.findByRole('button', { name: 'Language: As on my phone' }),
      ).toBeOnTheScreen();
    });
  });

  test('keeps the rest of her thread when one list fails', async () => {
    jest.mocked(listInspiration).mockRejectedValueOnce(new Error('offline'));
    await render(<Menu />);
    expect(await screen.findByText('Pink boots')).toBeOnTheScreen();
    expect(screen.getByText('White tank')).toBeOnTheScreen();
    // The counts need all three lists.
    expect(screen.queryByText('Pieces · Looks saved · Styled')).toBeNull();
  });

  test('shows her style in a few sentences under her name', async () => {
    await render(<Menu />);
    expect(await screen.findByText('High-low with a wink.')).toBeOnTheScreen();
  });

  test("shows the tagline when her style can't be loaded", async () => {
    jest.mocked(getStyle).mockRejectedValueOnce(new Error('offline'));
    await render(<Menu />);
    await waitFor(() => expect(getStyle).toHaveBeenCalled());
    expect(screen.queryByText('High-low with a wink.')).toBeNull();
    expect(screen.getByText('your closet · your mood')).toBeOnTheScreen();
  });
});
