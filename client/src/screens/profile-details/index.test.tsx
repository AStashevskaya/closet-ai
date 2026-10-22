import type { UserProfile } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { getProfile, updateProfile } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

import { ProfileDetails } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@/lib/api', () => ({ getProfile: jest.fn(), updateProfile: jest.fn() }));
jest.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ data: { user: { name: 'Anna' } } }),
    updateUser: jest.fn(),
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

describe('<ProfileDetails />', () => {
  test('saves the details filled in, and leaves the rest empty', async () => {
    await render(<ProfileDetails />);
    await fireEvent.press(await screen.findByText('Israel'));
    await fireEvent.changeText(screen.getByLabelText('City'), ' Tel Aviv ');
    await fireEvent.changeText(screen.getByLabelText('Year of birth'), '1994');
    await fireEvent.press(screen.getByText('Hourglass'));
    await fireEvent.changeText(screen.getByLabelText('Shoes'), '38');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(updateProfile).toHaveBeenCalledWith({
      country: 'IL',
      city: 'Tel Aviv',
      birthYear: 1994,
      heightCm: null,
      bodyShape: 'hourglass',
      sizeTop: 'S',
      sizeBottom: null,
      sizeShoes: '38',
    });
    // The name didn't change, so the account isn't touched.
    expect(authClient.updateUser).not.toHaveBeenCalled();
  });

  test('renames the account when the name changes', async () => {
    await render(<ProfileDetails />);
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Anya');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(authClient.updateUser).toHaveBeenCalledWith({ name: 'Anya' }));
  });

  test('says so when the server refuses a field', async () => {
    jest.mocked(updateProfile).mockRejectedValue(new Error('400'));
    await render(<ProfileDetails />);
    await fireEvent.changeText(await screen.findByLabelText('Height, cm'), '999');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText("Couldn't save. Check the fields and try again."),
    ).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
