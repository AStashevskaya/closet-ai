import type { ItemTags } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { createItem, getPhotoState, uploadPhoto } from '@/lib/api';
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
jest.mock('@/lib/api', () => ({
  uploadPhoto: jest.fn(),
  createItem: jest.fn(),
  getPhotoState: jest.fn(),
}));

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
  // Tagging off unless a test turns it on, so the form stays as the test fills it.
  jest.mocked(getPhotoState).mockResolvedValue({ status: 'ready', tagStatus: null, tags: null });
});

const tags: ItemTags = {
  recognized: true,
  name: 'White linen shirt',
  category: 'top',
  colors: ['white', 'beige'],
  seasons: ['spring', 'summer'],
  fit: 'relaxed',
  length: null,
  fabric: 'linen',
  style: 'casual',
  brand: null,
  condition: 'good',
};

// The server answers "still tagging" once, then with the tags.
function tagAfterOnePoll(result: ItemTags) {
  jest
    .mocked(getPhotoState)
    .mockResolvedValueOnce({ status: 'ready', tagStatus: 'pending', tags: null })
    .mockResolvedValue({ status: 'ready', tagStatus: 'done', tags: result });
}

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
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en');
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

  test('fills in the form from the photo', async () => {
    tagAfterOnePoll(tags);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(await screen.findByText('Recognising the item from the photo…')).toBeOnTheScreen();
    expect(
      await screen.findByText('Filled in from the photo — check it', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('White linen shirt');
    expect(screen.getByRole('checkbox', { name: 'Top' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beige' })).toBeChecked();

    await fireEvent.press(screen.getByText('Save'));
    expect(createItem).toHaveBeenCalledWith({
      name: 'White linen shirt',
      category: 'top',
      colors: ['white', 'beige'],
      // Not asked in the form: they come with the tags.
      seasons: ['spring', 'summer'],
      photoKey: 'photos/u1/p1.webp',
    });
  });

  test('never overwrites what the user already typed or picked', async () => {
    tagAfterOnePoll(tags);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'My favourite shirt');
    await fireEvent.press(screen.getByText('Dress'));

    await screen.findByText('Filled in from the photo — check it', {}, { timeout: 3000 });
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('My favourite shirt');
    expect(screen.getByRole('checkbox', { name: 'Dress' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Top' })).not.toBeChecked();
    // Colors were still empty, so those are filled in.
    expect(screen.getByRole('checkbox', { name: 'White' })).toBeChecked();
  });

  test('fills in nothing when the photo shows no single item', async () => {
    tagAfterOnePoll({ ...tags, recognized: false });
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    await waitFor(() => expect(getPhotoState).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('');
    expect(screen.queryByText('Filled in from the photo — check it')).not.toBeOnTheScreen();
  });

  test('uploads again on save when the first upload failed', async () => {
    jest
      .mocked(uploadPhoto)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('photos/u1/p2.webp');
    await render(<AddItem />);
    await fillForm();
    await fireEvent.press(screen.getByText('Save'));

    expect(uploadPhoto).toHaveBeenCalledTimes(2);
    expect(jest.mocked(createItem).mock.calls[0]?.[0].photoKey).toBe('photos/u1/p2.webp');
    expect(mockBack).toHaveBeenCalled();
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
