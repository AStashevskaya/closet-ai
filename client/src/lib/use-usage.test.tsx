import type { Usage } from '@closet-ai/shared';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getUsage } from './api';
import { useUsage } from './limits';

// The effect the screen runs on focus, so a test can come back to it.
let mockFocus: () => void = () => {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (effect: () => void) => {
      mockFocus = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('./api', () => ({ getUsage: jest.fn(), wantMore: jest.fn() }));

const usage = (used: number): Usage => ({
  want: { used: 0, limit: 5, resetsAt: '2026-12-01T00:00:00.000Z' },
  look: { used: 0, limit: 3, resetsAt: '2026-12-01T00:00:00.000Z' },
  wear_with: { used, limit: 8, resetsAt: '2026-11-09T00:00:00.000Z' },
});

function Counter() {
  const { usage: current } = useUsage();
  return <Text>{current ? `${current.wear_with.used} / ${current.wear_with.limit}` : 'none'}</Text>;
}

describe('useUsage', () => {
  test('shows the new count when the screen comes back into view', async () => {
    jest.mocked(getUsage).mockResolvedValue(usage(1));
    await render(<Counter />);
    expect(await screen.findByText('1 / 8')).toBeOnTheScreen();

    jest.mocked(getUsage).mockResolvedValue(usage(2));
    await act(async () => mockFocus());
    await waitFor(() => expect(screen.getByText('2 / 8')).toBeOnTheScreen());
  });

  test('keeps the last count when reading it again fails', async () => {
    jest.mocked(getUsage).mockResolvedValue(usage(1));
    await render(<Counter />);
    await screen.findByText('1 / 8');

    jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
    await act(async () => mockFocus());
    expect(screen.getByText('1 / 8')).toBeOnTheScreen();
  });
});
