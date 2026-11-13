import * as SecureStore from 'expo-secure-store';

import {
  firstPhotoDone,
  firstPhotoHintSeen,
  firstPhotoLessonSeen,
  forgetFirstPhoto,
  rememberFirstPhotoHint,
  rememberFirstPhotoLesson,
} from './first-photo';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn((key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));

describe('first photo', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  test('the hint and the lesson are each remembered on their own', async () => {
    expect(firstPhotoHintSeen()).toBe(false);
    expect(firstPhotoLessonSeen()).toBe(false);
    await rememberFirstPhotoHint();
    expect(firstPhotoHintSeen()).toBe(true);
    expect(firstPhotoLessonSeen()).toBe(false);
    await rememberFirstPhotoLesson();
    expect(firstPhotoLessonSeen()).toBe(true);
  });

  test('a closet with pieces marks both, writing only what is missing', async () => {
    await rememberFirstPhotoHint();
    jest.mocked(SecureStore.setItemAsync).mockClear();
    await firstPhotoDone();
    expect(firstPhotoLessonSeen()).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    await firstPhotoDone();
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  test('signing out forgets both', async () => {
    await firstPhotoDone();
    await forgetFirstPhoto();
    expect(firstPhotoHintSeen()).toBe(false);
    expect(firstPhotoLessonSeen()).toBe(false);
  });

  test('a store that cannot be read counts as seen', () => {
    jest.mocked(SecureStore.getItem).mockImplementationOnce(() => {
      throw new Error('locked');
    });
    expect(firstPhotoHintSeen()).toBe(true);
  });
});
