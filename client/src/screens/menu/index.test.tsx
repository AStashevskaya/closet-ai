import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { authClient } from '@/lib/auth-client';

import { Menu } from '.';

// The `mock` prefix lets the jest.mock factory below use it.
const mockNavigate = jest.fn();

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { name: 'Anna' } } }),
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

  test('opens the closet tab', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('My closet'));
    expect(mockNavigate).toHaveBeenCalledWith('/closet');
  });

  test('marks unbuilt sections as coming soon and disables them', async () => {
    await render(<Menu />);

    expect(screen.getAllByText('soon')).toHaveLength(7);
    expect(screen.getByRole('menuitem', { name: /Outfits/ })).toBeDisabled();
  });

  test('signs out', async () => {
    await render(<Menu />);
    await fireEvent.press(screen.getByText('Sign out'));
    expect(authClient.signOut).toHaveBeenCalled();
  });
});
