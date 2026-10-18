import { File } from 'expo-file-system';

import { uploadPhoto } from './api';

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
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ photoKey: 'photos/u1/p1.webp' }) });
  globalThis.fetch = fetchMock;
});

describe('uploadPhoto', () => {
  test('sends the photo as a file the global fetch (expo/fetch) can read', async () => {
    const key = await uploadPhoto('file:///small.jpg');

    expect(key).toBe('photos/u1/p1.webp');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/photos');
    expect(init.headers).toEqual({ cookie: 'session=abc' });
    // Not React Native's { uri, name, type }: expo/fetch rejects that.
    const [field, part] = append.mock.calls[0] as unknown as [string, { uri: string }];
    expect(field).toBe('photo');
    expect(part).toBeInstanceOf(File);
    expect(part.uri).toBe('file:///small.jpg');
  });
});
