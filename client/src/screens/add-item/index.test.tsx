import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { createItem, uploadPhoto } from '@/lib/api';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { AddItem } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({ uploadPhoto: jest.fn(), createItem: jest.fn() }));

const picked = {
  canceled: false,
  assets: [{ uri: 'file:///big.heic', width: 4032, height: 3024 }],
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked as never);
  jest
    .mocked(ImagePicker.requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: true } as never);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(picked as never);
  jest.mocked(shrinkPhoto).mockResolvedValue('file:///small.jpg');
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/p1.webp');
  jest.mocked(createItem).mockResolvedValue({} as never);
});

async function fillForm() {
  await fireEvent.press(screen.getByText('Choose from gallery'));
  await fireEvent.changeText(screen.getByLabelText('Name'), '  White linen shirt ');
  await fireEvent.press(screen.getByText('Top'));
  await fireEvent.press(screen.getByText('White'));
  await fireEvent.press(screen.getByText('Beige'));
}

describe('<AddItem />', () => {
  test('shrinks the photo, uploads it, then creates the item', async () => {
    await render(<AddItem />);
    await fillForm();
    await fireEvent.press(screen.getByText('Save'));

    expect(shrinkPhoto).toHaveBeenCalledWith(picked.assets[0]);
    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg');
    expect(createItem).toHaveBeenCalledWith({
      name: 'White linen shirt',
      category: 'top',
      colors: ['white', 'beige'],
      seasons: [],
      photoKey: 'photos/u1/p1.webp',
    });
    expect(mockBack).toHaveBeenCalled();
  });

  test('asks for a photo before anything else', async () => {
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByRole('alert')).toHaveTextContent('Add a photo of the item');
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  test('needs a color', async () => {
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Shirt');
    await fireEvent.press(screen.getByText('Top'));
    await fireEvent.press(screen.getByText('Save'));

    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one color');
  });

  test('allows at most five colors', async () => {
    await render(<AddItem />);
    await fillForm();
    for (const color of ['Black', 'Gray', 'Brown', 'Red']) {
      await fireEvent.press(screen.getByText(color));
    }
    await fireEvent.press(screen.getByText('Save'));

    expect(jest.mocked(createItem).mock.calls[0]?.[0].colors).toEqual([
      'white',
      'beige',
      'black',
      'gray',
      'brown',
    ]);
  });

  test('explains a denied camera permission', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValue({ granted: false } as never);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Take a photo'));

    expect(screen.getByRole('alert')).toHaveTextContent(/Allow camera access/);
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  test('stays on the form when saving fails', async () => {
    jest.mocked(uploadPhoto).mockRejectedValue(new Error('offline'));
    await render(<AddItem />);
    await fillForm();
    await fireEvent.press(screen.getByText('Save'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't save the item/);
    expect(mockBack).not.toHaveBeenCalled();
  });
});
