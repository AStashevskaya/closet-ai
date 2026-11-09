import type { Item } from '@closet-ai/shared';
import { render, screen, waitFor } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { listItems } from '@/lib/api';

import { ClosetBelt } from './closet-belt';

jest.mock('@/lib/api', () => ({
  listItems: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const closet = (count: number): Item[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `piece-${index}`,
    name: `Piece ${index}`,
    category: 'top',
    colors: ['white'],
    seasons: ['autumn'],
    photoUrl: `/api/items/${index}/photo`,
    cutoutUrl: `/api/items/${index}/cutout`,
    photoStatus: 'ready',
    createdAt: '2026-10-21T10:00:00.000Z',
  }));

const hidden = { includeHiddenElements: true };
const pieces = () => screen.queryAllByTestId('belt-piece', hidden);
const tag = () => screen.queryByTestId('waiting-tag', hidden);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('<ClosetBelt />', () => {
  test('rolls enough pieces: each hung twice for the loop', async () => {
    jest.mocked(listItems).mockResolvedValue(closet(5));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(10));
    expect(tag()).toBeOnTheScreen();
  });

  test('never more than 8 pieces', async () => {
    jest.mocked(listItems).mockResolvedValue(closet(20));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(16));
  });

  test('with fewer than 5 it does not roll: they just hang, and the tag runs', async () => {
    jest.mocked(listItems).mockResolvedValue(closet(4));
    await render(<ClosetBelt />);

    // Not doubled: the strip's motion and its second copy go together.
    await waitFor(() => expect(pieces()).toHaveLength(4));
    expect(tag()).toBeOnTheScreen();
  });

  test('an empty closet leaves the rail and the tag', async () => {
    jest.mocked(listItems).mockResolvedValue([]);
    await render(<ClosetBelt />);

    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(pieces()).toHaveLength(0);
    expect(tag()).toBeOnTheScreen();
  });

  test('a failed load stays silent: the rail and the tag', async () => {
    jest.mocked(listItems).mockRejectedValue(new Error('boom'));
    await render(<ClosetBelt />);

    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(pieces()).toHaveLength(0);
    expect(tag()).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  test('with Reduce Motion it does not roll, and the tag stays', async () => {
    const reduced = jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    jest.mocked(listItems).mockResolvedValue(closet(8));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(8));
    expect(tag()).toBeOnTheScreen();
    reduced.mockReturnValue(false);
  });

  test('is hidden from screen readers', async () => {
    jest.mocked(listItems).mockResolvedValue(closet(5));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(10));
    expect(screen.queryByTestId('closet-belt')).not.toBeOnTheScreen();
    expect(screen.getByTestId('closet-belt', hidden)).toBeOnTheScreen();
  });
});
