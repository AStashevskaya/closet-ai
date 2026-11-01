import type { ItemTags } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import i18n from '@/i18n';
import {
  askWearWith,
  createItem,
  getItem,
  getPhotoState,
  sessionHeaders,
  uploadPhoto,
} from '@/lib/api';
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
// The cropper reads the safe area.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn(), rotatePhoto: jest.fn() }));
// The real overlay draws its pieces only once it's laid out, which never happens under Jest:
// what flies is shown next to it here, so the tests can see the cut-out or the photo.
jest.mock('./hang-up', () => {
  const actual = jest.requireActual('./hang-up');
  const { View } = jest.requireActual('react-native');
  return {
    ...actual,
    HangUp: (props: { pieces: { key: string; photo: React.ReactNode }[] }) => (
      <>
        <actual.HangUp {...props} />
        {props.pieces.map((piece) => (
          <View key={piece.key} testID="hung-piece">
            {piece.photo}
          </View>
        ))}
      </>
    ),
  };
});
jest.mock('@/lib/api', () => ({
  // No usage unless a test gives one: the screens then show no counts.
  getUsage: jest.fn().mockRejectedValue(new Error('offline')),
  uploadPhoto: jest.fn(),
  createItem: jest.fn(),
  askWearWith: jest.fn(),
  getPhotoState: jest.fn(),
  getItem: jest.fn(),
  sessionHeaders: jest.fn(),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

// Presses one of the buttons of the last alert shown.
async function chooseInAlert(text: string) {
  const buttons = jest.mocked(Alert.alert).mock.lastCall?.[2] ?? [];
  await act(async () => buttons.find((b) => b.text === text)?.onPress?.());
}

const picked = {
  canceled: false,
  assets: [{ uri: 'file:///big.heic', width: 4032, height: 3024 }],
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await i18n.changeLanguage('en');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(picked as never);
  jest
    .mocked(ImagePicker.requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: true } as never);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(picked as never);
  jest.mocked(shrinkPhoto).mockResolvedValue('file:///small.jpg');
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/p1.webp');
  // Saved with its cut-out already made, unless a test says otherwise: it flies at once.
  jest
    .mocked(createItem)
    .mockResolvedValue({ id: 'new-item', cutoutUrl: '/cutouts/new.webp' } as never);
  jest.mocked(getItem).mockResolvedValue({ id: 'new-item' } as never);
  jest.mocked(sessionHeaders).mockResolvedValue({ cookie: 's=1' });
  jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
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
  await fireEvent.press(screen.getByText('Tops'));
  await pickColor('White');
  await pickColor('Beige');
}

async function pickColor(name: string) {
  await fireEvent.press(screen.getByRole('checkbox', { name }));
}

// Saving plays "Hang it up"; a tap on it closes the sheet without waiting for the end.
async function hangUp(rail = 'Tops') {
  await fireEvent.press(await screen.findByText(`On the ${rail} rail`));
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

  test('shows the photo and that it is recognising as soon as the gallery closes', async () => {
    // Shrinking takes a moment on a phone: held here until the test lets it go.
    let shrunk: (uri: string) => void = () => {};
    jest.mocked(shrinkPhoto).mockReturnValue(new Promise((resolve) => (shrunk = resolve)));
    await render(<AddItem />);
    // Not awaited: the press finishes only once the photo is shrunk.
    const pressing = fireEvent.press(screen.getByText('Choose from gallery'));
    expect(await screen.findByText('Recognising the item from the photo…')).toBeOnTheScreen();
    expect(uploadPhoto).not.toHaveBeenCalled();
    shrunk('file:///small.jpg');
    await pressing;
    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en');
  });

  test('keeps the photo she had when a new one cannot be opened', async () => {
    await render(<AddItem />);
    await fillForm();
    jest.mocked(shrinkPhoto).mockRejectedValueOnce(new Error('unsupported image'));
    await fireEvent.press(screen.getByText('Another photo'));
    await chooseInAlert('Take a photo');
    expect(await screen.findByText("Couldn't open this photo. Try another one.")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Hang it in the closet'));
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ photoKey: 'photos/u1/p1.webp' }),
    );
  });

  test('shrinks the photo, uploads it, then creates the item', async () => {
    await render(<AddItem />);
    await fillForm();
    await fireEvent.press(screen.getByText('Hang it in the closet'));

    expect(shrinkPhoto).toHaveBeenCalledWith(picked.assets[0]);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en');
    expect(createItem).toHaveBeenCalledWith({
      name: 'White linen shirt',
      category: 'top',
      colors: ['white', 'beige'],
      seasons: [],
      photoKey: 'photos/u1/p1.webp',
      brand: null,
      price: null,
      currency: null,
    });
    expect(mockBack).not.toHaveBeenCalled();
    await hangUp();
    expect(mockBack).toHaveBeenCalled();
  });

  test('offers only the photo before the fields', async () => {
    await render(<AddItem />);

    expect(screen.getByText('Shoot the whole piece on a plain background')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Name')).not.toBeOnTheScreen();
    expect(screen.queryByText('Hang it in the closet')).not.toBeOnTheScreen();
  });

  test('runs a bead down the thread while the photo is read', async () => {
    tagAfterOnePoll(tags);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(screen.getByTestId('thread-waiting', { includeHiddenElements: true })).toBeOnTheScreen();
    await screen.findByText('Filled in from the photo — check it', {}, { timeout: 3000 });
    expect(
      screen.queryByTestId('thread-waiting', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
  });

  test('closes the sheet on its own after hanging the piece', async () => {
    jest.useFakeTimers();
    try {
      await render(<AddItem />);
      await fillForm();
      await fireEvent.press(screen.getByText('Hang it in the closet'));
      await act(() => jest.advanceTimersByTimeAsync(700));
      expect(screen.getByText('On the Tops rail')).toBeOnTheScreen();
      expect(mockBack).not.toHaveBeenCalled();

      await act(() => jest.advanceTimersByTimeAsync(3500));
      expect(mockBack).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('flies the cut-out, not the photo with its background', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    async function saveWithoutCutout() {
      jest.mocked(createItem).mockResolvedValue({ id: 'new-item' } as never);
      await render(<AddItem />);
      await fillForm();
      await fireEvent.press(screen.getByText('Hang it in the closet'));
    }

    test('at once when the saved piece already has one', async () => {
      await render(<AddItem />);
      await fillForm();
      await fireEvent.press(screen.getByText('Hang it in the closet'));
      await act(() => jest.advanceTimersByTimeAsync(0));

      // First the background dissolves on the print: the cut-out over the photo, which fades.
      expect(screen.getByTestId('band-cutout')).toBeOnTheScreen();
      expect(screen.getByTestId('band-photo')).toHaveStyle({ opacity: 0 });
      expect(
        screen.queryByTestId('hung-piece', { includeHiddenElements: true }),
      ).not.toBeOnTheScreen();

      // Then the bare piece flies.
      await act(() => jest.advanceTimersByTimeAsync(700));
      expect(screen.getByTestId('hung-cutout', { includeHiddenElements: true })).toBeOnTheScreen();
      expect(Image.prefetch).toHaveBeenCalledWith('http://api/cutouts/new.webp', {
        headers: { cookie: 's=1' },
      });
      expect(getItem).not.toHaveBeenCalled();
    });

    test('when it arrives while the screen waits on the thread', async () => {
      jest
        .mocked(getItem)
        .mockResolvedValueOnce({ id: 'new-item' } as never)
        .mockResolvedValue({ id: 'new-item', cutoutUrl: '/cutouts/new.webp' } as never);
      await saveWithoutCutout();

      // Saved, waiting: the bead runs, nothing flies yet.
      expect(
        screen.getByTestId('thread-waiting', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('hung-piece', { includeHiddenElements: true }),
      ).not.toBeOnTheScreen();

      await act(() => jest.advanceTimersByTimeAsync(1800));
      expect(screen.getByTestId('hung-cutout', { includeHiddenElements: true })).toBeOnTheScreen();
      expect(getItem).toHaveBeenCalledTimes(2);
    });

    test('the photo when none comes in time', async () => {
      await saveWithoutCutout();
      await act(() => jest.advanceTimersByTimeAsync(4000));
      expect(
        screen.queryByTestId('hung-piece', { includeHiddenElements: true }),
      ).not.toBeOnTheScreen();

      await act(() => jest.advanceTimersByTimeAsync(1500));
      expect(screen.getByTestId('hung-photo', { includeHiddenElements: true })).toBeOnTheScreen();
      expect(
        screen.queryByTestId('hung-cutout', { includeHiddenElements: true }),
      ).not.toBeOnTheScreen();
    });

    test('stops waiting when the sheet closes', async () => {
      await saveWithoutCutout();
      await act(() => jest.advanceTimersByTimeAsync(600));
      const asked = jest.mocked(getItem).mock.calls.length;
      await screen.unmount();
      await act(() => jest.advanceTimersByTimeAsync(6000));

      expect(getItem).toHaveBeenCalledTimes(asked);
      expect(mockBack).not.toHaveBeenCalled();
    });
  });

  test('needs a color', async () => {
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Shirt');
    await fireEvent.press(screen.getByText('Tops'));
    await fireEvent.press(screen.getByText('Hang it in the closet'));

    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one color');
  });

  test('allows at most five colors', async () => {
    await render(<AddItem />);
    await fillForm();
    for (const color of ['Black', 'Gray', 'Brown', 'Red']) {
      await pickColor(color);
    }
    await fireEvent.press(screen.getByText('Hang it in the closet'));

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
    expect(screen.getByRole('checkbox', { name: 'Tops' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beige' })).toBeChecked();

    await fireEvent.press(screen.getByText('Hang it in the closet'));
    expect(createItem).toHaveBeenCalledWith({
      name: 'White linen shirt',
      category: 'top',
      colors: ['white', 'beige'],
      // Not asked in the form: they come with the tags.
      seasons: ['spring', 'summer'],
      photoKey: 'photos/u1/p1.webp',
      brand: null,
      price: null,
      currency: null,
    });
  });

  test('never overwrites what the user already typed or picked', async () => {
    tagAfterOnePoll(tags);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'My favourite shirt');
    await fireEvent.press(screen.getByText('Dresses'));

    await screen.findByText('Filled in from the photo — check it', {}, { timeout: 3000 });
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('My favourite shirt');
    expect(screen.getByRole('checkbox', { name: 'Dresses' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tops' })).not.toBeChecked();
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
    await fireEvent.press(screen.getByText('Hang it in the closet'));

    expect(uploadPhoto).toHaveBeenCalledTimes(2);
    expect(jest.mocked(createItem).mock.calls[0]?.[0].photoKey).toBe('photos/u1/p2.webp');
    await hangUp();
    expect(mockBack).toHaveBeenCalled();
  });

  test('stays on the form when saving fails', async () => {
    jest.mocked(uploadPhoto).mockRejectedValue(new Error('offline'));
    await render(<AddItem />);
    await fillForm();
    await fireEvent.press(screen.getByText('Hang it in the closet'));

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
    await fireEvent.press(await screen.findByLabelText('Rotate'));

    await waitFor(() => expect(uploadPhoto).toHaveBeenLastCalledWith('file:///turned.jpg', 'en'));
    expect(rotatePhoto).toHaveBeenCalledWith('file:///small.jpg');
  });
  test('saves the brand and the price with its currency', async () => {
    jest.mocked(createItem).mockResolvedValue({ id: 'new-item' } as never);
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Linen shirt');
    await fireEvent.press(screen.getByText('Tops'));
    await pickColor('White');
    await fireEvent.press(screen.getByLabelText('Add brand and price'));
    await fireEvent.changeText(screen.getByLabelText('Brand'), ' COS ');
    await fireEvent.changeText(screen.getByLabelText('Price'), '349,90');
    await fireEvent.press(screen.getByText('₪ ILS'));
    await fireEvent.press(screen.getByText('Hang it in the closet'));

    await waitFor(() =>
      expect(createItem).toHaveBeenCalledWith(
        expect.objectContaining({ brand: 'COS', price: 349.9, currency: 'ILS' }),
      ),
    );
  });

  test("won't save a price that isn't a number", async () => {
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Linen shirt');
    await fireEvent.press(screen.getByText('Tops'));
    await pickColor('White');
    await fireEvent.press(screen.getByLabelText('Add brand and price'));
    await fireEvent.changeText(screen.getByLabelText('Price'), 'about 300');
    await fireEvent.press(screen.getByText('Hang it in the closet'));

    expect(
      await screen.findByText('Check the price: just the number, like 349.90'),
    ).toBeOnTheScreen();
    expect(createItem).not.toHaveBeenCalled();
  });

  test('opens the cropper on the picked photo', async () => {
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.press(await screen.findByLabelText('Crop'));

    expect(screen.getByRole('header', { name: 'Crop to the item' })).toBeOnTheScreen();
  });
  test('saves the item and goes on to the outfits for it', async () => {
    jest
      .mocked(createItem)
      .mockResolvedValue({ id: 'new-item', name: 'Linen shirt', photoUrl: '/p' } as never);
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<AddItem />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Linen shirt');
    await fireEvent.press(screen.getByText('Tops'));
    await pickColor('White');
    await fireEvent.press(screen.getByText('Hang it and style it'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/styled/[id]',
        params: { id: 'req-1', item: 'new-item', name: 'Linen shirt', photoUrl: '/p' },
      }),
    );
    expect(askWearWith).toHaveBeenCalledWith({ itemId: 'new-item' }, 'en');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
