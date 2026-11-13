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

const anna = 'user-anna';
const olga = 'user-olga';

describe('first photo', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.clearAllMocks();
  });

  test('the hint and the lesson are each remembered on their own', async () => {
    expect(firstPhotoHintSeen(anna)).toBe(false);
    expect(firstPhotoLessonSeen(anna)).toBe(false);
    await rememberFirstPhotoHint(anna);
    expect(firstPhotoHintSeen(anna)).toBe(true);
    expect(firstPhotoLessonSeen(anna)).toBe(false);
    await rememberFirstPhotoLesson(anna);
    expect(firstPhotoLessonSeen(anna)).toBe(true);
  });

  test('each account on the phone has its own', async () => {
    await firstPhotoDone(anna);
    expect(firstPhotoHintSeen(olga)).toBe(false);
    expect(firstPhotoLessonSeen(olga)).toBe(false);
  });

  test('keys hold only what SecureStore allows', async () => {
    await rememberFirstPhotoHint('a b/c');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('firstPhoto.hintSeen.a_b_c', '1');
  });

  test('a closet with pieces marks both, writing only what is missing', async () => {
    await rememberFirstPhotoHint(anna);
    jest.mocked(SecureStore.setItemAsync).mockClear();
    await firstPhotoDone(anna);
    expect(firstPhotoLessonSeen(anna)).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    await firstPhotoDone(anna);
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  });

  test('signing out forgets hers only', async () => {
    await firstPhotoDone(anna);
    await firstPhotoDone(olga);
    await forgetFirstPhoto(anna);
    expect(firstPhotoHintSeen(anna)).toBe(false);
    expect(firstPhotoLessonSeen(anna)).toBe(false);
    expect(firstPhotoHintSeen(olga)).toBe(true);
  });

  test('no one signed in: nothing is shown or written', async () => {
    expect(firstPhotoHintSeen(undefined)).toBe(true);
    await firstPhotoDone(undefined);
    await forgetFirstPhoto(undefined);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  test('a store that cannot be read counts as seen', () => {
    jest.mocked(SecureStore.getItem).mockImplementationOnce(() => {
      throw new Error('locked');
    });
    expect(firstPhotoHintSeen(anna)).toBe(true);
  });

  test('a store that cannot be written is shrugged off', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('locked'));
    await expect(rememberFirstPhotoHint(anna)).resolves.toBeUndefined();
    expect(firstPhotoHintSeen(anna)).toBe(false);
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
    await expect(forgetFirstPhoto(anna)).resolves.toBeUndefined();
  });
});
