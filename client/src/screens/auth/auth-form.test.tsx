import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import i18n from '@/i18n';
import { authClient } from '@/lib/auth-client';

import { AuthForm } from './auth-form';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: jest.fn() }, signUp: { email: jest.fn() } },
}));

const signIn = jest.mocked(authClient.signIn.email);
const signUp = jest.mocked(authClient.signUp.email);

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

async function fill(placeholder: string, value: string) {
  await fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);
}

describe('<AuthForm mode="sign-in" />', () => {
  test('signs in with the trimmed email', async () => {
    signIn.mockResolvedValue({ data: {}, error: null } as never);
    await render(<AuthForm mode="sign-in" />);

    await fill('Email', '  anna@example.com ');
    await fill('Password', 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button'));

    expect(signIn).toHaveBeenCalledWith({
      email: 'anna@example.com',
      password: 'correct-horse-battery',
    });
  });

  test('shows a translated error for wrong credentials', async () => {
    signIn.mockResolvedValue({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } } as never);
    await render(<AuthForm mode="sign-in" />);

    await fill('Email', 'anna@example.com');
    await fill('Password', 'wrong-password');
    await fireEvent.press(screen.getByRole('button'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');
    // iOS doesn't read a new alert out by itself.
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Wrong email or password',
    );
  });

  test('submits from the keyboard on the password field', async () => {
    signIn.mockResolvedValue({ data: {}, error: null } as never);
    await render(<AuthForm mode="sign-in" />);

    await fill('Email', 'anna@example.com');
    await fill('Password', 'correct-horse-battery');
    await fireEvent(screen.getByPlaceholderText('Password'), 'submitEditing');

    expect(signIn).toHaveBeenCalledTimes(1);
  });

  test('runs a bead along the thread while it waits, and keeps the screen', async () => {
    let answer: (value: unknown) => void = () => {};
    signIn.mockReturnValue(new Promise((resolve) => (answer = resolve)) as never);
    await render(<AuthForm mode="sign-in" />);

    await fill('Email', 'anna@example.com');
    await fill('Password', 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button'));

    expect(screen.getByTestId('thread-waiting', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByPlaceholderText('Email')).toBeOnTheScreen();

    await act(async () => answer({ data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }));

    expect(
      screen.queryByTestId('thread-waiting', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  test('switches to sign-up in place, keeping what was typed', async () => {
    await render(<AuthForm mode="sign-in" />);
    expect(screen.getByText('Your closet is waiting')).toBeOnTheScreen();
    await fill('Email', 'anna@example.com');

    await fireEvent.press(screen.getByRole('link', { name: 'No account? Start one' }));

    expect(screen.getByRole('header')).toHaveTextContent('Start your closet');
    expect(screen.getByText('Your closet goes here')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Your name')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Email')).toHaveDisplayValue('anna@example.com');
    expect(screen.getByRole('button')).toHaveTextContent('Start my closet');
  });

  test('recovers when the server cannot be reached', async () => {
    // better-fetch throws on network failure instead of returning { error }.
    signIn.mockRejectedValue(new TypeError('Network request failed'));
    await render(<AuthForm mode="sign-in" />);

    await fill('Email', 'anna@example.com');
    await fill('Password', 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Can't reach the server/);
    expect(screen.getByRole('button')).toBeEnabled();
  });

  test('does not call the server with empty fields', async () => {
    await render(<AuthForm mode="sign-in" />);
    await fireEvent.press(screen.getByRole('button'));

    expect(screen.getByRole('alert')).toHaveTextContent('Fill in all fields');
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('<AuthForm mode="sign-up" />', () => {
  test('rejects a short password before calling the server', async () => {
    await render(<AuthForm mode="sign-up" />);

    await fill('Your name', 'Anna');
    await fill('Email', 'anna@example.com');
    await fill('Password', '1234567');
    await fireEvent.press(screen.getByRole('button'));

    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters');
    expect(signUp).not.toHaveBeenCalled();
  });

  test('shows that the email is taken', async () => {
    signUp.mockResolvedValue({ data: null, error: { code: 'USER_ALREADY_EXISTS' } } as never);
    await render(<AuthForm mode="sign-up" />);

    await fill('Your name', 'Anna');
    await fill('Email', 'anna@example.com');
    await fill('Password', 'correct-horse-battery');
    await fireEvent.press(screen.getByRole('button'));

    expect(signUp).toHaveBeenCalledWith({
      name: 'Anna',
      email: 'anna@example.com',
      password: 'correct-horse-battery',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account with this email already exists',
    );
  });

  test('shows the app name, a sign-up heading and empty hangers', async () => {
    await render(<AuthForm mode="sign-up" />);

    expect(screen.getByText('CLOSET')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent('Start your closet');
    expect(screen.getByText('Your closet goes here')).toBeOnTheScreen();
    expect(screen.getByText('8 characters or more')).toBeOnTheScreen();
  });

  test('switches to sign-in in place and clears the error', async () => {
    await render(<AuthForm mode="sign-up" />);
    await fireEvent.press(screen.getByRole('button'));
    expect(screen.getByRole('alert')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('link', { name: 'Have an account? Sign in' }));

    expect(screen.getByRole('header')).toHaveTextContent('Welcome back');
    expect(screen.queryByPlaceholderText('Your name')).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(screen.getByText('Your closet is waiting')).toBeOnTheScreen();
  });

  test('renders in Hebrew', async () => {
    await i18n.changeLanguage('he');
    await render(<AuthForm mode="sign-up" />);

    expect(screen.getByPlaceholderText('סיסמה')).toBeOnTheScreen();
    expect(screen.getByText('לפתוח ארון')).toBeOnTheScreen();
    expect(screen.getByText('כאן יהיה הארון שלך')).toBeOnTheScreen();
  });
});
