import type { StyleState } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

import i18n from '@/i18n';
import { ApiError, getStyle, refreshStyle } from '@/lib/api';
import { MAX_STYLE_POLLS, STYLE_POLL_MS, useStyle } from '@/lib/style';

import { StyleCard } from './style-card';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api-error')>('@/lib/api-error'),
  getStyle: jest.fn(),
  refreshStyle: jest.fn(),
}));
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

// As the closet uses it: the state held outside the card.
function Closet() {
  return <StyleCard {...useStyle('en')} />;
}

const written = '2026-10-21T12:00:00.000Z';
const state = (patch: Partial<StyleState>): StyleState => ({
  summary: 'High-low with a wink.',
  writtenAt: written,
  updating: false,
  suggest: null,
  ...patch,
});

// Offered, tapped, and the brief now being written.
async function askForUpdate() {
  jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 5, looks: 2 } }));
  jest.mocked(refreshStyle).mockResolvedValue(state({ updating: true }));
  await render(<Closet />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Update my style' }));
}

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
    await render(<Closet />);
    await waitFor(() => expect(getStyle).toHaveBeenCalled());
    expect(screen.queryByRole('summary')).toBeNull();
  });

  test('offers an update after a day of new pieces, then shows the new style', async () => {
    jest.useFakeTimers();
    await askForUpdate();
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
    expect(screen.queryByRole('summary')).toBeNull();
  });

  test('says what was added, items and looks alike', async () => {
    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 5, looks: 2 } }));
    const { rerender } = await render(<Closet />);
    expect(
      await screen.findByText('New today: 5 items and 2 saved looks. Update your style with them?'),
    ).toBeOnTheScreen();

    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 0, looks: 3 } }));
    await rerender(<></>);
    await rerender(<Closet />);
    expect(
      await screen.findByText('New today: 3 saved looks. Update your style with them?'),
    ).toBeOnTheScreen();
  });

  test('keeps checking after a check fails, and gives up kindly after ten minutes', async () => {
    jest.useFakeTimers();
    await askForUpdate();
    jest.mocked(getStyle).mockRejectedValueOnce(new Error('offline'));
    jest.mocked(getStyle).mockResolvedValue(state({ updating: true }));
    for (let i = 0; i < MAX_STYLE_POLLS; i++) {
      await act(() => jest.advanceTimersByTimeAsync(STYLE_POLL_MS));
    }
    expect(getStyle).toHaveBeenCalledTimes(1 + MAX_STYLE_POLLS);
    expect(screen.getByText(/taking longer than usual/)).toBeOnTheScreen();
    // No more checks after that.
    await act(() => jest.advanceTimersByTimeAsync(STYLE_POLL_MS * 3));
    expect(getStyle).toHaveBeenCalledTimes(1 + MAX_STYLE_POLLS);
  });

  test("says it didn't work when nothing new came back", async () => {
    jest.useFakeTimers();
    await askForUpdate();
    jest.mocked(getStyle).mockResolvedValue(state({}));
    await act(() => jest.advanceTimersByTimeAsync(STYLE_POLL_MS));
    expect(screen.getByText("Couldn't update your style. Try again later.")).toBeOnTheScreen();
  });

  test('an update already on its way just reloads, without an error', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 5, looks: 0 } }));
    jest.mocked(refreshStyle).mockRejectedValue(new ApiError(409, 'style:updating'));
    await render(<Closet />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Update my style' }));
    expect(alert).not.toHaveBeenCalled();
    expect(getStyle).toHaveBeenCalledTimes(2);
  });

  test('"Not now" hides it until tomorrow', async () => {
    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 6, looks: 0 } }));
    await render(<Closet />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Great shopping!')).toBeNull();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'closet.shoppingDismissed',
      new Date().toDateString(),
    );
  });

  test('stays hidden on a day it was put off', async () => {
    jest.mocked(SecureStore.getItem).mockReturnValueOnce(new Date().toDateString());
    jest.mocked(getStyle).mockResolvedValue(state({ suggest: { items: 6, looks: 0 } }));
    await render(<Closet />);
    await waitFor(() => expect(getStyle).toHaveBeenCalled());
    expect(screen.queryByText('Great shopping!')).toBeNull();
  });
});
