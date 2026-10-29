import type { UserProfile } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import i18n from '@/i18n';
import { getProfile, updateProfile } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

import { ProfileDetails } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api', () => ({ getProfile: jest.fn(), updateProfile: jest.fn() }));
jest.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { name: 'Anna' } } }),
    updateUser: jest.fn(),
    signOut: jest.fn(),
  },
}));

const empty: UserProfile = {
  country: null,
  city: null,
  birthYear: null,
  heightCm: null,
  bodyShape: null,
  sizeTop: null,
  sizeBottom: null,
  sizeShoes: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(getProfile).mockResolvedValue({ ...empty, sizeTop: 'S' });
  jest.mocked(updateProfile).mockResolvedValue(empty);
});

// Done with a field: the keyboard's Done (or tapping away) ends editing with what she typed.
async function type(label: string, text: string) {
  const input = screen.getByLabelText(label);
  await fireEvent.changeText(input, text);
  await fireEvent(input, 'endEditing', { nativeEvent: { text } });
}

describe('<ProfileDetails />', () => {
  test('reads as a card: her name, her measurements, dashed where nothing is known', async () => {
    await render(<ProfileDetails />);
    expect(await screen.findByText('Anna')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Tops, S' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Height, add' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Country, add' })).toBeOnTheScreen();
    // No Save button: each change is saved on its own.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  test('saves a value as soon as she is done with it, and only what changed', async () => {
    jest.mocked(updateProfile).mockResolvedValue({ ...empty, sizeTop: 'S', heightCm: 168 });
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Height, add' }));
    // Why the stylist wants it, under the field.
    expect(screen.getByText('For proportions: skirt lengths, how trousers sit')).toBeOnTheScreen();
    await type('Height, cm', '168');

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ heightCm: 168 }));
    expect(await screen.findByRole('button', { name: 'Height, 168' })).toBeOnTheScreen();
    expect(screen.getByText('Saved')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Height, cm')).toBeNull();
  });

  test('saves the open field before opening another, each with its own value', async () => {
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Height, add' }));
    await fireEvent.changeText(screen.getByLabelText('Height, cm'), '168');
    await fireEvent.press(screen.getByRole('button', { name: 'Shoes, add' }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ heightCm: 168 }));
    expect(screen.getByLabelText('Shoes')).toBeOnTheScreen();
    expect(updateProfile).toHaveBeenCalledTimes(1);
  });

  test('picks a country, Belarus first, a city and a body shape', async () => {
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Country, add' }));
    const [first] = screen.getAllByRole('checkbox');
    expect(within(first!).getByText('Belarus')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Belarus'));
    expect(updateProfile).toHaveBeenLastCalledWith({ country: 'BY' });
    await type('City', ' Minsk ');
    expect(updateProfile).toHaveBeenLastCalledWith({ city: 'Minsk' });

    await fireEvent.press(screen.getByRole('button', { name: 'Silhouette, add' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Hourglass' }));
    expect(updateProfile).toHaveBeenLastCalledWith({ bodyShape: 'hourglass' });
  });

  test('renames the account when the name changes', async () => {
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Name, Anna' }));
    await type('Name', 'Anya');
    await waitFor(() => expect(authClient.updateUser).toHaveBeenCalledWith({ name: 'Anya' }));
    expect(updateProfile).not.toHaveBeenCalled();
  });

  test('keeps the field open with what she typed when the server refuses it', async () => {
    jest.mocked(updateProfile).mockRejectedValue(new Error('400'));
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Height, add' }));
    await type('Height, cm', '999');

    expect(
      await screen.findByText("Couldn't save. Check the fields and try again."),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Height, cm').props.value).toBe('999');
  });

  test('signs out and opens account deletion', async () => {
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(authClient.signOut).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
    expect(mockPush).toHaveBeenCalledWith('/delete-account');
  });
});
