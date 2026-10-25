import type { StyleState } from '@closet-ai/shared';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import i18n from '@/i18n';
import { getStyle, refreshStyle } from '@/lib/api';
import { STYLE_POLL_MS } from '@/lib/style';

import { StyleCard } from './style-card';

jest.mock('@/lib/api', () => ({ getStyle: jest.fn(), refreshStyle: jest.fn() }));
jest.mock('expo-router', () => ({
  // As if the closet had just come into view.
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('expo-secure-store', () => ({ getItem: jest.fn(() => null), setItemAsync: jest.fn() }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));

const written = '2026-10-21T12:00:00.000Z';
const state = (patch: Partial<StyleState>): StyleState => ({
  summary: 'High-low with a wink.',
  writtenAt: written,
  updating: false,
  suggest: null,
  ...patch,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('<StyleCard />', () => {
  test('shows nothing without a shopping day', async () => {
    jest.mocked(getStyle).mockResolvedValue(state({}));
    await render(<StyleCard />);
    expect(screen.queryByText('Great shopping!')).toBeNull();
  });

  test('offers an update after a day of new pieces, then shows the new style', async () => {
    jest.useFakeTimers();
    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 5, looks: 2 } }));
    jest.mocked(refreshStyle).mockResolvedValue(state({ updating: true }));
    await render(<StyleCard />);

    expect(await screen.findByText('Great shopping!')).toBeOnTheScreen();
    expect(
      screen.getByText('New today: 5 items and 2 saved looks. Update your style with them?'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Update my style' }));
    expect(refreshStyle).toHaveBeenCalledWith('en');
    expect(screen.getByText('Updating your style')).toBeOnTheScreen();

    // The brief is back on the next check.
    jest
      .mocked(getStyle)
      .mockResolvedValue(
        state({ summary: 'Knits for autumn now.', writtenAt: '2026-10-22T13:05:00.000Z' }),
      );
    await act(() => jest.advanceTimersByTimeAsync(STYLE_POLL_MS));
    expect(screen.getByText('Your style is updated')).toBeOnTheScreen();
    expect(screen.getByText('Knits for autumn now.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Nice' }));
    expect(screen.queryByText('Your style is updated')).toBeNull();
  });

  test('"Not now" hides it until tomorrow', async () => {
    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 6, looks: 0 } }));
    await render(<StyleCard />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Great shopping!')).toBeNull();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'closet.shoppingDismissed',
      new Date().toDateString(),
    );
  });
});
