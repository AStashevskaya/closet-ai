import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { authClient } from '@/lib/auth-client';

import { DeleteAccount } from '.';

jest.mock('@/lib/auth-client', () => ({
  authClient: { deleteUser: jest.fn(), signOut: jest.fn() },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<DeleteAccount />', () => {
  test('deletes the account with the password and signs out', async () => {
    jest.mocked(authClient.deleteUser).mockResolvedValue({ data: {}, error: null } as never);
    await render(<DeleteAccount />);
    await fireEvent.changeText(screen.getByLabelText('Your password'), 'correct-horse');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete for good' }));

    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled());
    expect(authClient.deleteUser).toHaveBeenCalledWith({ password: 'correct-horse' });
  });

  test('says when the password is wrong, and stays signed in', async () => {
    jest.mocked(authClient.deleteUser).mockResolvedValue({
      data: null,
      error: { code: 'INVALID_PASSWORD', status: 400 },
    } as never);
    await render(<DeleteAccount />);
    await fireEvent.changeText(screen.getByLabelText('Your password'), 'nope');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete for good' }));

    expect(await screen.findByText('Wrong password')).toBeOnTheScreen();
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test('needs a password first', async () => {
    await render(<DeleteAccount />);
    expect(screen.getByRole('button', { name: 'Delete for good' })).toBeDisabled();
  });
});
