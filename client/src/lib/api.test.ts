import { File } from 'expo-file-system';

import {
  addLookItems,
  ApiError,
  createItem,
  deleteItem,
  getPhotoState,
  HEAVY_TIMEOUT_MS,
  listItems,
  OfflineError,
  POLL_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  rotateItem,
  updateItem,
  uploadPhoto,
} from './api';
import { onClosetChanged } from './closet-changes';

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));
jest.mock('./auth-client', () => ({
  authClient: { getCookie: jest.fn().mockResolvedValue('session=abc') },
}));
jest.mock('./api-url', () => ({ apiUrl: () => 'http://api.test' }));

const fetchMock = jest.fn();
const append = jest.spyOn(FormData.prototype, 'append');

beforeEach(() => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ photoKey: 'photos/u1/p1.webp', status: 'processing' }),
  });
  globalThis.fetch = fetchMock;
});

describe('calls that change her closet', () => {
  // The tests below read the first call made.
  afterEach(() => {
    fetchMock.mockClear();
  });

  const look = { photoKey: 'k', pieces: [] } as unknown as Parameters<typeof addLookItems>[0];
  const piece = { name: 'n' } as unknown as Parameters<typeof createItem>[0];
  test.each([
    ['createItem (one piece, the batch, a wish, "add to my closet")', () => createItem(piece)],
    ['updateItem', () => updateItem('i', {})],
    ['rotateItem', () => rotateItem('i')],
    ['deleteItem', () => deleteItem('i')],
    ['addLookItems (the selfie)', () => addLookItems(look)],
  ])('%s says so once the answer is in, whatever it was', async (_name, call) => {
    const heard = jest.fn();
    const stop = onClosetChanged(heard);
    let answer: (response: unknown) => void = () => undefined;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    const pending = call().catch(() => undefined);
    expect(heard).not.toHaveBeenCalled();
    answer({ ok: false, status: 500, json: async () => ({ message: 'boom' }) });
    await pending;

    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  test('reading the closet does not', async () => {
    const heard = jest.fn();
    const stop = onClosetChanged(heard);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });

    await listItems();

    expect(heard).not.toHaveBeenCalled();
    stop();
  });
});

describe('uploadPhoto', () => {
  test('sends the photo as a file the global fetch (expo/fetch) can read', async () => {
    const key = await uploadPhoto('file:///small.jpg', 'ru');

    expect(key).toBe('photos/u1/p1.webp');
    const [url, init] = fetchMock.mock.calls[0];
    // The language the suggested item name should come back in.
    expect(url).toMatch(/^http:\/\/api\.test\/api\/photos\?lang=ru&kind=item&attempt=[\w-]+$/);
    expect(init.headers).toEqual({ cookie: 'session=abc' });
    // Not React Native's { uri, name, type }: expo/fetch rejects that.
    const [field, part] = append.mock.calls[0] as unknown as [string, { uri: string }];
    expect(field).toBe('photo');
    expect(part).toBeInstanceOf(File);
    expect(part.uri).toBe('file:///small.jpg');
  });
});

describe('uploadPhoto again', () => {
  const attemptOf = (call: number) =>
    new URL(fetchMock.mock.calls[call]![0]).searchParams.get('attempt');

  test('a retry of the same file has the same name, a new upload a new one', async () => {
    fetchMock.mockClear();
    fetchMock.mockRejectedValueOnce(new Error('no answer'));
    await expect(uploadPhoto('file:///retry.jpg', 'ru')).rejects.toBeInstanceOf(OfflineError);
    await uploadPhoto('file:///retry.jpg', 'ru');
    expect(attemptOf(1)).toBe(attemptOf(0));

    // Gone through: the same file sent later is a new upload.
    await uploadPhoto('file:///retry.jpg', 'ru');
    expect(attemptOf(2)).not.toBe(attemptOf(0));
  });
});

describe('getPhotoState', () => {
  test('escapes the key, whose slashes would otherwise break the query', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ready',
        tagStatus: 'pending',
        tags: null,
        lookItems: null,
        matches: null,
      }),
    });

    const state = await getPhotoState('photos/u1/p1.webp');

    expect(state).toEqual({
      status: 'ready',
      tagStatus: 'pending',
      tags: null,
      lookItems: null,
      matches: null,
    });
    expect(fetchMock.mock.lastCall?.[0]).toBe(
      'http://api.test/api/photos/status?key=photos%2Fu1%2Fp1.webp',
    );
  });
});

describe('deleteItem', () => {
  test('sends DELETE with the session cookie and does not read the empty body', async () => {
    const json = jest.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));
    fetchMock.mockResolvedValue({ ok: true, status: 204, json });

    await deleteItem('item-1');

    const [url, init] = fetchMock.mock.calls.at(-1);
    expect(url).toBe('http://api.test/api/items/item-1');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ cookie: 'session=abc' });
    expect(json).not.toHaveBeenCalled();
  });

  test('throws an ApiError when the server refuses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ message: 'item not found' }),
    });

    await expect(deleteItem('item-1')).rejects.toEqual(new ApiError(404, 'item not found'));
  });
});

describe('rotateItem', () => {
  test('names the photo she is looking at, so a retry does not turn it twice', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: '', json: async () => null });

    await rotateItem('item-1', '/api/items/item-1/photo?v=ab12cd34').catch(() => {});

    expect(fetchMock.mock.lastCall?.[0]).toBe('http://api.test/api/items/item-1/rotate?v=ab12cd34');
  });
});

describe('a request with no answer', () => {
  // A server that never answers: fetch only ends when it's aborted.
  function neverAnswers() {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // Lets the call reach fetch: it reads the session cookie first.
  const reachFetch = () => jest.advanceTimersByTimeAsync(0);

  test('counts as no connection after the time limit, and not before', async () => {
    neverAnswers();
    const settled = jest.fn();
    const call = deleteItem('item-1');
    const failed = expect(call).rejects.toBeInstanceOf(OfflineError);
    void call.catch(settled);

    await reachFetch();
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await failed;
  });

  test('a check in a polling loop gives up sooner, so the loop can count on it', async () => {
    neverAnswers();
    const failed = expect(getPhotoState('photos/u1/p1.webp')).rejects.toBeInstanceOf(OfflineError);

    await reachFetch();
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    await failed;
  });

  test('a refusal stays a refusal, even when its body never comes', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    }));
    const failed = expect(deleteItem('item-1')).rejects.toEqual(
      new ApiError(429, 'Too Many Requests'),
    );

    await reachFetch();
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await failed;
  });

  test('a body that never comes counts too', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    }));
    const failed = expect(getPhotoState('photos/u1/p1.webp')).rejects.toBeInstanceOf(OfflineError);

    await reachFetch();
    await jest.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);
    await failed;
  });

  test('a photo on a slow network gets longer', async () => {
    neverAnswers();
    const settled = jest.fn();
    const call = uploadPhoto('file:///small.jpg', 'ru');
    const failed = expect(call).rejects.toBeInstanceOf(OfflineError);
    void call.catch(settled);

    await reachFetch();
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(HEAVY_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await failed;
  });

  test('an answer in time leaves no timer behind', async () => {
    await getPhotoState('photos/u1/p1.webp').catch(() => {});
    expect(jest.getTimerCount()).toBe(0);
  });
});
