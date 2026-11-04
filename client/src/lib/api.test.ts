import { File } from 'expo-file-system';

import {
  ApiError,
  deleteItem,
  getPhotoState,
  HEAVY_TIMEOUT_MS,
  OfflineError,
  POLL_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  rotateItem,
  uploadPhoto,
} from './api';

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

describe('uploadPhoto', () => {
  test('sends the photo as a file the global fetch (expo/fetch) can read', async () => {
    const key = await uploadPhoto('file:///small.jpg', 'ru');

    expect(key).toBe('photos/u1/p1.webp');
    const [url, init] = fetchMock.mock.calls[0];
    // The language the suggested item name should come back in.
    expect(url).toBe('http://api.test/api/photos?lang=ru&kind=item');
    expect(init.headers).toEqual({ cookie: 'session=abc' });
    // Not React Native's { uri, name, type }: expo/fetch rejects that.
    const [field, part] = append.mock.calls[0] as unknown as [string, { uri: string }];
    expect(field).toBe('photo');
    expect(part).toBeInstanceOf(File);
    expect(part.uri).toBe('file:///small.jpg');
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
