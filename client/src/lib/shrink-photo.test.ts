import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { shrinkPhoto } from './shrink-photo';

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
  test('scales a camera photo down to about 4 MP', async () => {
    await shrinkPhoto({ uri: 'file:///in.heic', width: 4032, height: 3024 });
    expect(resize).toHaveBeenCalledWith({ width: 2366 });
  });

  test('keeps a tall phone screenshot at its full width', async () => {
    await shrinkPhoto({ uri: 'file:///in.png', width: 1170, height: 2532 });
    expect(resize).not.toHaveBeenCalled();
  });

  test('leaves a small photo at its size but still re-encodes it as JPEG', async () => {
    const uri = await shrinkPhoto({ uri: 'file:///in.png', width: 800, height: 600 });
    expect(resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.9, format: SaveFormat.JPEG });
    expect(uri).toBe('file:///out.jpg');
  });
});
