import type { Item } from '@closet-ai/shared';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { listItems } from '@/lib/api';
import { clearClosetPieces } from '@/lib/closet-pieces';

import { ClosetBelt } from './closet-belt';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(),
}));
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

const setWidth = (width: number) =>
  jest.mocked(useWindowDimensions).mockReturnValue({ width, height: 844, scale: 3, fontScale: 1 });

// Reanimated's mock makes a new shared value on every render, which real ones never do, and jumps
// straight to where an animation ends. These keep theirs; the first made is the strip's, since the
// belt renders before its rail's tag.
const realSharedValue = Reanimated.useSharedValue;
let made: Reanimated.SharedValue<number>[] = [];
function useKeptValue(init: unknown) {
  const kept = useRef<Reanimated.SharedValue<number> | null>(null);
  if (!kept.current) {
    kept.current = realSharedValue(init as number);
    made.push(kept.current);
  }
  return kept.current;
}
const stripProgress = () => made[0]!;
// How far the strip has moved, as last rendered.
const shift = () =>
  (
    StyleSheet.flatten(screen.getByTestId('closet-belt-strip', hidden).props.style) as {
      transform: { translateX: number }[];
    }
  ).transform[0]!.translateX;

beforeEach(() => {
  jest.clearAllMocks();
  clearClosetPieces();
  setWidth(390);
  made = [];
  jest.spyOn(Reanimated, 'useSharedValue').mockImplementation(useKeptValue as never);
});

// So a failed assertion can't leave Reduce Motion on for the next test.
afterEach(() => {
  jest.restoreAllMocks();
});

describe('<ClosetBelt />', () => {
  test('rolls enough pieces: a loop over the strip, each piece hung twice on a phone', async () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    jest.mocked(listItems).mockResolvedValue(closet(5));
    const view = await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(10));
    expect(tag()).toBeOnTheScreen();
    // 5 pieces of 84 pt at 30 pt a second.
    expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 14_000 }));
    // The mock jumps to the end of the round, against the reading direction.
    await view.rerender(<ClosetBelt />);
    expect(shift()).toBe(-420);
  });

  test('stops rolling when it leaves the screen', async () => {
    const cancel = jest.spyOn(Reanimated, 'cancelAnimation');
    jest.mocked(listItems).mockResolvedValue(closet(5));
    const view = await render(<ClosetBelt />);
    await waitFor(() => expect(pieces()).toHaveLength(10));
    const progress = stripProgress();
    cancel.mockClear();

    await view.unmount();

    expect(cancel.mock.calls.some(([value]) => value === progress)).toBe(true);
  });

  test('stopping part-way round puts the pieces back where they hang', async () => {
    const reduced = jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(false);
    jest.mocked(listItems).mockResolvedValue(closet(5));
    const view = await render(<ClosetBelt />);
    await waitFor(() => expect(pieces()).toHaveLength(10));
    await view.rerender(<ClosetBelt />);
    expect(stripProgress().get()).toBe(1);

    reduced.mockReturnValue(true);
    await view.rerender(<ClosetBelt />);

    expect(stripProgress().get()).toBe(0);
    expect(pieces()).toHaveLength(5);
    await view.rerender(<ClosetBelt />);
    expect(Math.abs(shift())).toBe(0);
  });

  test('hangs enough copies for a screen wider than a round', async () => {
    setWidth(1024);
    jest.mocked(listItems).mockResolvedValue(closet(5));
    await render(<ClosetBelt />);

    // A round is 420 pt: three to cover the screen, and one more to scroll in.
    await waitFor(() => expect(pieces()).toHaveLength(20));
  });

  test('never more than 8 pieces', async () => {
    jest.mocked(listItems).mockResolvedValue(closet(20));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(16));
  });

  test('with fewer than 5 it does not roll: they just hang, and the tag runs', async () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    jest.mocked(listItems).mockResolvedValue(closet(4));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(4));
    expect(tag()).toBeOnTheScreen();
    // 4 pieces would take 11.2 s a round; the tag has its own, shorter run.
    expect(timing).not.toHaveBeenCalledWith(1, expect.objectContaining({ duration: 11_200 }));
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
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const timing = jest.spyOn(Reanimated, 'withTiming');
    jest.mocked(listItems).mockResolvedValue(closet(8));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(8));
    expect(tag()).toBeOnTheScreen();
    expect(timing).not.toHaveBeenCalled();
  });

  test('is hidden from screen readers', async () => {
    jest.mocked(listItems).mockResolvedValue(closet(5));
    await render(<ClosetBelt />);

    await waitFor(() => expect(pieces()).toHaveLength(10));
    expect(screen.queryByTestId('closet-belt')).not.toBeOnTheScreen();
    expect(screen.getByTestId('closet-belt', hidden)).toBeOnTheScreen();
  });
});
