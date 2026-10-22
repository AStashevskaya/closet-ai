import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import i18n from '@/i18n';
import { authClient } from '@/lib/auth-client';

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
}));
jest.mock('@/lib/api', () => ({
  getUsage: jest.fn().mockResolvedValue({
    want: { used: 2, limit: 5, resetsAt: '2026-11-01T00:00:00.000Z' },
    look: { used: 0, limit: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
    wear_with: { used: 1, limit: 30, resetsAt: '2026-10-22T00:00:00.000Z' },
  }),
}));
jest.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: 'user-1', name: 'Anna' } } }),
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
    await fireEvent.press(screen.getByText('Want / Can'));
    expect(mockNavigate).toHaveBeenCalledWith('/want-can');
  });

  test('marks unbuilt sections as coming soon and disables them', async () => {
    await render(<Menu />);

    expect(screen.getAllByText('soon')).toHaveLength(5);
    expect(screen.getByRole('menuitem', { name: /Trends/ })).toBeDisabled();
  });

  test('shows what is left of the limits', async () => {
    await render(<Menu />);
    expect(await screen.findByText('2 / 5')).toBeOnTheScreen();
    expect(screen.getByText('1 / 30')).toBeOnTheScreen();
  });

  describe('report a problem', () => {
    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
    });

    test('opens a letter to support with the details to look into it', async () => {
      process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@closet.test';
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
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

  test('opens my details', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('My details'));
    expect(mockPush).toHaveBeenCalledWith('/profile-details');
  });

  test('opens account deletion', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('Delete account'));
    expect(mockPush).toHaveBeenCalledWith('/delete-account');
  });

  test('signs out', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('Sign out'));
    expect(authClient.signOut).toHaveBeenCalled();
  });
});
