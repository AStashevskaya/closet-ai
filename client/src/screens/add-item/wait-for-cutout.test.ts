import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';

import { getItem } from '@/lib/api';

import { CUTOUT_POLL_MS, CUTOUT_WAIT_MS, waitForCutout } from './wait-for-cutout';

jest.mock('@/lib/api', () => ({
  getItem: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 's=1' }),
  absoluteUrl: (path: string) => `http://api${path}`,
}));
jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));

const saved = { id: 'i1', name: 'Shirt', photoUrl: '/p' } as Item;
const detail = (cutoutUrl?: string) => ({ ...saved, cutoutUrl, tags: null }) as never;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(Image.prefetch).mockResolvedValue(true);
});
afterEach(() => jest.useRealTimers());

describe('waitForCutout', () => {
  test('takes a cut-out the item already has, without asking again', async () => {
    const cutout = await waitForCutout({ ...saved, cutoutUrl: '/c' }, new AbortController().signal);
    expect(cutout).toEqual({ uri: 'http://api/c', headers: { cookie: 's=1' } });
    expect(getItem).not.toHaveBeenCalled();
    expect(Image.prefetch).toHaveBeenCalledWith('http://api/c', { headers: { cookie: 's=1' } });
  });

  test('asks until the cut-out is there', async () => {
    jest.mocked(getItem).mockResolvedValueOnce(detail()).mockResolvedValue(detail('/c'));
    const waiting = waitForCutout(saved, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(CUTOUT_POLL_MS * 2);
    expect(await waiting).toEqual({ uri: 'http://api/c', headers: { cookie: 's=1' } });
    expect(getItem).toHaveBeenCalledTimes(2);
  });

  test('gives up after a while', async () => {
    jest.mocked(getItem).mockResolvedValue(detail());
    const waiting = waitForCutout(saved, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(CUTOUT_WAIT_MS + CUTOUT_POLL_MS);
    expect(await waiting).toBeNull();
    expect(getItem).toHaveBeenCalledTimes(CUTOUT_WAIT_MS / CUTOUT_POLL_MS);
  });

  test('stops asking when the sheet closes', async () => {
    jest.mocked(getItem).mockResolvedValue(detail());
    const closing = new AbortController();
    const waiting = waitForCutout(saved, closing.signal);
    await jest.advanceTimersByTimeAsync(CUTOUT_POLL_MS);
    closing.abort();
    expect(await waiting).toBeNull();
    await jest.advanceTimersByTimeAsync(CUTOUT_WAIT_MS);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  test("flies the photo when the cut-out won't load", async () => {
    jest.mocked(Image.prefetch).mockResolvedValue(false);
    expect(
      await waitForCutout({ ...saved, cutoutUrl: '/c' }, new AbortController().signal),
    ).toBeNull();
  });
});
