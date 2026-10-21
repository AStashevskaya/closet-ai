import type { ItemTags } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { askWearWith, createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { rotatePhoto, shrinkPhoto } from '@/lib/shrink-photo';

import { AddItem } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: mockReplace }) }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
// Leaving needs a real navigator; the screens' own navigations go straight through here.
jest.mock('@/lib/use-confirm-leave', () => ({
  useConfirmLeave: () => (navigate: () => void) => navigate(),
}));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn(), rotatePhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
  // No usage unless a test gives one: the screens then show no counts.
  getUsage: jest.fn().mockRejectedValue(new Error('offline')),
  uploadPhoto: jest.fn(),
  createItem: jest.fn(),
  askWearWith: jest.fn(),
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
  jest.mocked(getPhotoState).mockResolvedValue({
    status: 'ready',
    tagStatus: null,
    tags: null,
    lookItems: null,
    matches: null,
  });
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
  noun: null,
};

// The server answers "still tagging" once, then with the tags.
function tagAfterOnePoll(result: ItemTags) {
  jest
    .mocked(getPhotoState)
    .mockResolvedValueOnce({
      status: 'ready',
      tagStatus: 'pending',
      tags: null,
      lookItems: null,
      matches: null,
    })
    .mockResolvedValue({
      status: 'ready',
      tagStatus: 'done',
      tags: result,
      lookItems: null,
      matches: null,
    });
}

async function fillForm() {
  await fireEvent.press(screen.getByText('Choose from gallery'));
  await fireEvent.changeText(screen.getByLabelText('Name'), '  White linen shirt ');
  await fireEvent.press(screen.getByText('Top'));
  await fireEvent.press(screen.getByText('White'));
  await fireEvent.press(screen.getByText('Beige'));
}

describe('<AddItem />', () => {
  test('offers a whole outfit from a selfie until a photo is picked', async () => {
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('A whole outfit? Add every item from a selfie'));
    expect(mockReplace).toHaveBeenCalledWith('/add-look');

    await fireEvent.press(screen.getByText('Choose from gallery'));
    expect(
      screen.queryByText('A whole outfit? Add every item from a selfie'),
    ).not.toBeOnTheScreen();
  });

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
  test('sends several gallery photos to the screen that adds them all', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///a.heic', width: 4032, height: 3024 },
        { uri: 'file:///b.heic', width: 3024, height: 4032 },
      ],
    } as never);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true }),
    );
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/add-items',
      params: {
        photos: JSON.stringify([
          { uri: 'file:///a.heic', width: 4032, height: 3024 },
          { uri: 'file:///b.heic', width: 3024, height: 4032 },
        ]),
      },
    });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });
  test('turns the photo and uploads the turned copy', async () => {
    jest.mocked(rotatePhoto).mockResolvedValue('file:///turned.jpg');
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.press(await screen.findByLabelText('Rotate photo'));

    await waitFor(() => expect(uploadPhoto).toHaveBeenLastCalledWith('file:///turned.jpg', 'en'));
    expect(rotatePhoto).toHaveBeenCalledWith('file:///small.jpg');
  });
  test('saves the item and goes on to the outfits for it', async () => {
    jest.mocked(createItem).mockResolvedValue({ id: 'new-item' } as never);
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Linen shirt');
    await fireEvent.press(screen.getByText('Top'));
    await fireEvent.press(screen.getByText('White'));
    await fireEvent.press(screen.getByText('Save and style it'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/wear-with/[id]',
        params: { id: 'req-1' },
      }),
    );
    expect(askWearWith).toHaveBeenCalledWith({ itemId: 'new-item' }, 'en');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
