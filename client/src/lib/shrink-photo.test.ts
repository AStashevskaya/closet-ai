import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { shrinkPhoto, UPLOAD_MAX_SIDE } from './shrink-photo';

const resize = jest.fn();
const saveAsync = jest.fn().mockResolvedValue({ uri: 'file:///out.jpg' });

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(ImageManipulator.manipulate).mockReturnValue({
    resize,
    renderAsync: async () => ({ saveAsync }),
  } as never);
});

describe('shrinkPhoto', () => {
  test('scales a landscape photo down by its width', async () => {
    await shrinkPhoto({ uri: 'file:///in.heic', width: 4032, height: 3024 });
    expect(resize).toHaveBeenCalledWith({ width: UPLOAD_MAX_SIDE });
  });

  test('scales a portrait photo down by its height', async () => {
    await shrinkPhoto({ uri: 'file:///in.heic', width: 3024, height: 4032 });
    expect(resize).toHaveBeenCalledWith({ height: UPLOAD_MAX_SIDE });
  });

  test('leaves a small photo at its size but still re-encodes it as JPEG', async () => {
    const uri = await shrinkPhoto({ uri: 'file:///in.png', width: 800, height: 600 });
    expect(resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.9, format: SaveFormat.JPEG });
    expect(uri).toBe('file:///out.jpg');
  });
});
