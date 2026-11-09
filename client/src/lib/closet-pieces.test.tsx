import type { Item } from '@closet-ai/shared';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { listItems } from '@/lib/api';

import { clearClosetPieces, piecesToHang, useClosetPieces } from './closet-pieces';

jest.mock('@/lib/api', () => ({
  listItems: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
}));

const piece = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  name: id,
  category: 'top',
  colors: ['white'],
  seasons: ['autumn'],
  photoUrl: `/photo/${id}`,
  cutoutUrl: `/cutout/${id}`,
  photoStatus: 'ready',
  createdAt: '2026-10-21T10:00:00.000Z',
  ...extra,
});
// A read that answers only when told, to see what shows before it does.
const pending = () => {
  let answer: (items: Item[]) => void = () => undefined;
  const read = new Promise<Item[]>((resolve) => {
    answer = resolve;
  });
  return { read, answer: (items: Item[]) => answer(items) };
};
const ids = (result: { current: { pieces: Item[] } }) => result.current.pieces.map((p) => p.id);

beforeEach(() => {
  jest.clearAllMocks();
  clearClosetPieces();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('piecesToHang', () => {
  test('cut-outs first, no shoes, nothing without a picture, up to the most asked for', () => {
    const items = [
      piece('photo', { cutoutUrl: undefined }),
      piece('shoes', { category: 'shoes' }),
      piece('none', { photoUrl: undefined, cutoutUrl: undefined }),
      piece('a'),
      piece('b'),
    ];
    expect(piecesToHang(items, 3).map((p) => p.id)).toEqual(['a', 'b', 'photo']);
    expect(piecesToHang(items, 1).map((p) => p.id)).toEqual(['a']);
  });
});

describe('useClosetPieces', () => {
  test('a second screen right after the first has them at once, without reading again', async () => {
    jest.mocked(listItems).mockResolvedValue([piece('a')]);
    const first = await renderHook(() => useClosetPieces(4));
    await waitFor(() => expect(ids(first.result)).toEqual(['a']));

    const second = await renderHook(() => useClosetPieces(8));

    expect(ids(second.result)).toEqual(['a']);
    expect(second.result.current.headers).toEqual({ cookie: 'session' });
    expect(listItems).toHaveBeenCalledTimes(1);
  });

  test('two screens at once share one read', async () => {
    jest.mocked(listItems).mockResolvedValue([piece('a')]);
    const first = await renderHook(() => useClosetPieces(4));
    const second = await renderHook(() => useClosetPieces(8));

    await waitFor(() => expect(ids(second.result)).toEqual(['a']));
    expect(ids(first.result)).toEqual(['a']);
    expect(listItems).toHaveBeenCalledTimes(1);
  });

  test('an older read shows at once and is refreshed, so a new piece turns up', async () => {
    jest.mocked(listItems).mockResolvedValueOnce([piece('a')]);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = await renderHook(() => useClosetPieces(4));
    await waitFor(() => expect(ids(first.result)).toEqual(['a']));

    now.mockReturnValue(1_000_000 + 61_000);
    const refresh = pending();
    jest.mocked(listItems).mockReturnValueOnce(refresh.read);
    const second = await renderHook(() => useClosetPieces(4));

    expect(ids(second.result)).toEqual(['a']);
    await act(async () => refresh.answer([piece('new'), piece('a')]));
    await waitFor(() => expect(ids(second.result)).toEqual(['new', 'a']));
  });

  test('a failed refresh keeps what was read', async () => {
    jest.mocked(listItems).mockResolvedValueOnce([piece('a')]);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = await renderHook(() => useClosetPieces(4));
    await waitFor(() => expect(ids(first.result)).toEqual(['a']));

    now.mockReturnValue(1_000_000 + 61_000);
    jest.mocked(listItems).mockRejectedValueOnce(new Error('boom'));
    const second = await renderHook(() => useClosetPieces(4));

    await waitFor(() => expect(listItems).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(ids(second.result)).toEqual(['a']);
  });

  test('after signing out the next account does not see the last one', async () => {
    jest.mocked(listItems).mockResolvedValueOnce([piece('hers')]);
    const first = await renderHook(() => useClosetPieces(4));
    await waitFor(() => expect(ids(first.result)).toEqual(['hers']));

    clearClosetPieces();
    const theirs = pending();
    jest.mocked(listItems).mockReturnValueOnce(theirs.read);
    const next = await renderHook(() => useClosetPieces(4));

    expect(ids(next.result)).toEqual([]);
    await act(async () => theirs.answer([piece('theirs')]));
    await waitFor(() => expect(ids(next.result)).toEqual(['theirs']));
  });

  test('a read still on its way when she signs out never lands in the next account', async () => {
    const hers = pending();
    jest.mocked(listItems).mockReturnValueOnce(hers.read);
    const first = await renderHook(() => useClosetPieces(4));
    await waitFor(() => expect(listItems).toHaveBeenCalledTimes(1));

    clearClosetPieces();
    await act(async () => hers.answer([piece('hers')]));

    expect(ids(first.result)).toEqual([]);
    jest.mocked(listItems).mockResolvedValueOnce([]);
    const next = await renderHook(() => useClosetPieces(4));
    expect(ids(next.result)).toEqual([]);
    await waitFor(() => expect(listItems).toHaveBeenCalledTimes(2));
  });
});
