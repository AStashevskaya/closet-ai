import type { Item, LookItem, PhotoState } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { StrictMode } from 'react';
import { AccessibilityInfo, Linking } from 'react-native';

import i18n from '@/i18n';
import { askWearWith, getPhotoState, getUsage, listItems, uploadPhoto } from '@/lib/api';
import { ApiError, OfflineError } from '@/lib/api-error';
import { clearClosetPieces } from '@/lib/closet-pieces';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { colors } from '@/theme';

import { WearWithPick } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
  uploadPhoto: jest.fn(),
  getPhotoState: jest.fn(),
  askWearWith: jest.fn(),
  getUsage: jest.fn(),
  listItems: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const lookItem = (name: string, category: LookItem['category']): LookItem => ({
  name,
  category,
  colors: ['red'],
  seasons: ['autumn'],
  fit: null,
  length: null,
  fabric: null,
  style: null,
  brand: null,
  condition: null,
  box: { xMin: 0.2, yMin: 0.2, xMax: 0.8, yMax: 0.6 },
  noun: null,
});

const closetPiece = (id: string, category: Item['category'] = 'top'): Item => ({
  id,
  name: `Piece ${id}`,
  category,
  colors: ['white'],
  seasons: ['autumn'],
  photoUrl: `/api/items/${id}/photo`,
  cutoutUrl: `/api/items/${id}/cutout`,
  photoStatus: 'ready',
  createdAt: '2026-10-21T10:00:00.000Z',
});

// Her pieces are decoration, hidden from screen readers.
const hung = () => screen.queryAllByTestId('closet-piece', { includeHiddenElements: true });

const found = (items: LookItem[]): PhotoState => ({
  status: 'ready',
  tagStatus: 'done',
  tags: null,
  lookItems: items,
  matches: null,
});

beforeEach(async () => {
  jest.clearAllMocks();
  clearClosetPieces();
  await i18n.changeLanguage('en');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///shot.png', width: 1170, height: 2532 }],
  } as never);
  jest.mocked(shrinkPhoto).mockResolvedValue('file:///small.jpg');
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/wear.webp');
  jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
  jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
  jest.mocked(listItems).mockResolvedValue([]);
});

describe('<WearWithPick />', () => {
  test('lets the user pick the item when the photo shows several', async () => {
    jest
      .mocked(getPhotoState)
      .mockResolvedValue(
        found([lookItem('White shirt', 'top'), lookItem('Red leather skirt', 'bottom')]),
      );
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en', 'wear');
    expect(
      await screen.findByText(
        'There are a few things here: tap the one you mean',
        {},
        { timeout: 3000 },
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Red leather skirt' }));

    expect(askWearWith).toHaveBeenCalledWith({ photoKey: 'photos/u1/wear.webp', index: 1 }, 'en');
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/wear-with/[id]',
      params: { id: 'req-1' },
    });
  });

  test('hangs several pieces on the rail, one button each, and keeps them all reachable', async () => {
    const names = ['Shirt', 'Skirt', 'Bag', 'Scarf', 'Belt'];
    jest
      .mocked(getPhotoState)
      .mockResolvedValue(found(names.map((name) => lookItem(name, 'accessory'))));
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    await screen.findByText(
      'There are a few things here: tap the one you mean',
      {},
      { timeout: 3000 },
    );
    for (const name of names) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
  });

  test('after a tap the chosen piece stays and the others go, while its outfits are asked for', async () => {
    jest
      .mocked(getPhotoState)
      .mockResolvedValue(found([lookItem('Shirt', 'top'), lookItem('Skirt', 'bottom')]));
    jest.mocked(askWearWith).mockReturnValue(new Promise(() => {}));
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    await fireEvent.press(await screen.findByRole('button', { name: 'Skirt' }, { timeout: 3000 }));

    expect(screen.getByRole('button', { name: 'Skirt' })).toBeOnTheScreen();
    // The other is on its way out, gone from screen readers too.
    expect(screen.queryByRole('button', { name: 'Shirt' })).not.toBeOnTheScreen();
    expect(
      screen.getByRole('progressbar', { name: 'Putting looks together from your closet…' }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('thread-waiting', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  test('a limit reached on a piece keeps what was found on the rail, with the message under it', async () => {
    jest
      .mocked(getPhotoState)
      .mockResolvedValue(found([lookItem('Shirt', 'top'), lookItem('Skirt', 'bottom')]));
    jest.mocked(askWearWith).mockRejectedValue(new ApiError(429, 'limit:wear_with'));
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    await fireEvent.press(await screen.findByRole('button', { name: 'Skirt' }, { timeout: 3000 }));

    expect(await screen.findByText("That's 1 for today. Ask again tomorrow.")).toBeOnTheScreen();
    expect(screen.getByText('I want more')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Skirt' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Shirt' })).toBeOnTheScreen();
    expect(screen.queryByText(/tap the one you mean/)).not.toBeOnTheScreen();
    expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
  });

  test('a limit reached on the only piece brings the photo back, with the message under it', async () => {
    jest.mocked(getPhotoState).mockResolvedValue(found([lookItem('Skirt', 'bottom')]));
    jest.mocked(askWearWith).mockRejectedValue(new ApiError(429, 'limit:wear_with'));
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(
      await screen.findByText("That's 1 for today. Ask again tomorrow.", {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('print-photo', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
  });

  test('leaving while the outfits are asked for leaves her where she went', async () => {
    jest
      .mocked(getPhotoState)
      .mockResolvedValue(found([lookItem('Shirt', 'top'), lookItem('Skirt', 'bottom')]));
    let answer: (started: { id: string }) => void = () => undefined;
    jest.mocked(askWearWith).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Skirt' }, { timeout: 3000 }));

    await view.unmount();
    await act(async () => answer({ id: 'req-1' }));

    expect(mockReplace).not.toHaveBeenCalled();
  });

  test("still goes on under Strict Mode, whose double effect run mustn't count as leaving", async () => {
    jest
      .mocked(getPhotoState)
      .mockResolvedValue(found([lookItem('Shirt', 'top'), lookItem('Skirt', 'bottom')]));
    await render(
      <StrictMode>
        <WearWithPick />
      </StrictMode>,
    );
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Skirt' }, { timeout: 3000 }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });

  describe('a picker that will not open', () => {
    const cameraFailed = "Couldn't open the camera. Choose a photo from the gallery.";

    test.each([
      ['asking for the camera', () => ImagePicker.requestCameraPermissionsAsync],
      ['opening the camera', () => ImagePicker.launchCameraAsync],
    ])('%s failing says so, and is no refusal', async (_name, failing) => {
      jest
        .mocked(ImagePicker.requestCameraPermissionsAsync)
        .mockResolvedValue({ granted: true } as never);
      jest.mocked(failing()).mockRejectedValueOnce(new Error('no camera'));
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Take a photo'));

      expect(await screen.findByText(cameraFailed)).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith(cameraFailed);
      expect(screen.queryByText(/No access to the camera/)).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Choose from gallery' })).toBeOnTheScreen();
    });

    test('the gallery failing says so, and the next try clears it', async () => {
      jest
        .mocked(ImagePicker.launchImageLibraryAsync)
        .mockRejectedValueOnce(new Error('no gallery'));
      jest.mocked(getPhotoState).mockReturnValue(new Promise(() => {}));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      const failed = "Couldn't open the gallery. Try again.";
      expect(await screen.findByText(failed)).toBeOnTheScreen();
      expect(uploadPhoto).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByText('Choose from gallery'));

      expect(
        await screen.findByRole('progressbar', { name: 'Finding the item on the photo…' }),
      ).toBeOnTheScreen();
      expect(screen.queryByText(failed)).not.toBeOnTheScreen();
    });
  });

  test('goes straight to the outfits when there is one item', async () => {
    jest.mocked(getPhotoState).mockResolvedValue(found([lookItem('Red leather skirt', 'bottom')]));
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled(), { timeout: 3000 });
    expect(askWearWith).toHaveBeenCalledWith({ photoKey: 'photos/u1/wear.webp', index: 0 }, 'en');
  });

  test("says so when today's outfits are used up", async () => {
    jest.mocked(uploadPhoto).mockRejectedValue(new ApiError(429, 'limit:wear_with'));
    await render(<WearWithPick />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(await screen.findByText("That's 1 for today. Ask again tomorrow.")).toBeOnTheScreen();
    expect(screen.getByText('I want more')).toBeOnTheScreen();
  });

  describe('the empty rail', () => {
    test('asks what we are trying on, with the gallery as the main action and no grey block', async () => {
      await render(<WearWithPick />);

      expect(screen.getByRole('header', { name: 'What are we trying on?' })).toBeOnTheScreen();
      expect(screen.getByText(/A screenshot or a photo of one item/)).toBeOnTheScreen();
      expect(
        screen.getByText('your find will hang here', { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Choose from gallery' })).toHaveStyle({
        backgroundColor: colors.bead,
      });
    });

    test('hangs up to four of her pieces either side, leaving the shoes out', async () => {
      jest
        .mocked(listItems)
        .mockResolvedValue([
          closetPiece('a', 'shoes'),
          ...['b', 'c', 'd', 'e', 'f'].map((id) => closetPiece(id)),
        ]);
      await render(<WearWithPick />);

      await waitFor(() => expect(hung()).toHaveLength(4));
      expect(screen.queryAllByTestId('bare-piece', { includeHiddenElements: true })).toHaveLength(
        4,
      );
    });

    test('a closet that fails to load neither blocks the screen nor says anything', async () => {
      jest.mocked(listItems).mockRejectedValue(new Error('boom'));
      jest
        .mocked(getPhotoState)
        .mockResolvedValue(found([lookItem('Shirt', 'top'), lookItem('Skirt', 'bottom')]));
      await render(<WearWithPick />);

      await waitFor(() => expect(listItems).toHaveBeenCalled());
      expect(hung()).toHaveLength(0);
      expect(screen.getByRole('header', { name: 'What are we trying on?' })).toBeOnTheScreen();
      expect(screen.queryByRole('alert')).not.toBeOnTheScreen();

      await fireEvent.press(screen.getByText('Choose from gallery'));
      expect(
        await screen.findByRole('button', { name: 'Skirt' }, { timeout: 3000 }),
      ).toBeOnTheScreen();
    });

    test('a closet still loading does not hold anything up', async () => {
      jest.mocked(listItems).mockReturnValue(new Promise(() => {}));
      jest.mocked(getPhotoState).mockResolvedValue(found([lookItem('Skirt', 'bottom')]));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      await waitFor(() => expect(mockReplace).toHaveBeenCalled(), { timeout: 3000 });
    });
  });

  describe('the camera refused', () => {
    beforeEach(() => {
      jest
        .mocked(ImagePicker.requestCameraPermissionsAsync)
        .mockResolvedValue({ granted: false } as never);
    });
    const denied = /No access to the camera/;

    test('says so and offers the settings and the gallery instead', async () => {
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Take a photo'));

      expect(await screen.findByText(denied)).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith(expect.stringMatching(denied));
      expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
      expect(screen.queryByText('Take a photo')).not.toBeOnTheScreen();
      // Only the message and the buttons change: nothing above them jumps.
      expect(screen.getByRole('header', { name: 'What are we trying on?' })).toBeOnTheScreen();
      expect(screen.getByText('Everyday')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Open settings' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Choose from gallery' })).toBeOnTheScreen();
    });

    test('opens the settings, and the camera can be tried again after', async () => {
      const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Take a photo'));

      await fireEvent.press(await screen.findByRole('button', { name: 'Open settings' }));

      expect(open).toHaveBeenCalled();
      expect(screen.queryByText(denied)).not.toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Take a photo' })).toBeOnTheScreen();
    });

    test('the gallery still works, and the message goes', async () => {
      jest.mocked(getPhotoState).mockReturnValue(new Promise(() => {}));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Take a photo'));

      await fireEvent.press(await screen.findByRole('button', { name: 'Choose from gallery' }));

      expect(
        await screen.findByRole('progressbar', { name: 'Finding the item on the photo…' }),
      ).toBeOnTheScreen();
      expect(screen.queryByText(denied)).not.toBeOnTheScreen();
    });
  });

  describe('waiting in place', () => {
    const unread: PhotoState = {
      status: 'failed',
      tagStatus: 'failed',
      tags: null,
      lookItems: null,
      matches: null,
    };

    test('the photo hangs on the rail with the tag running while the pieces are found', async () => {
      jest.mocked(getPhotoState).mockReturnValue(new Promise(() => {}));
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      const waiting = await screen.findByRole('progressbar', {
        name: 'Finding the item on the photo…',
      });
      expect(waiting).toBeOnTheScreen();
      expect(
        screen.getByTestId('thread-waiting', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith('Finding the item on the photo…');
      expect(screen.queryByText('Try again')).not.toBeOnTheScreen();
    });

    test('a photo the server gave up on stays on the rail and only offers another', async () => {
      jest.mocked(getPhotoState).mockResolvedValueOnce(unread);
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      expect(await screen.findByText("Couldn't read this photo. Try again.")).toBeOnTheScreen();
      expect(screen.getByTestId('print-photo', { includeHiddenElements: true })).toBeOnTheScreen();
      expect(
        screen.queryByTestId('thread-waiting', { includeHiddenElements: true }),
      ).not.toBeOnTheScreen();
      expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
      // It would only fail the same way: the server doesn't read a failed photo again.
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
      expect(screen.getByText('Choose from gallery')).toBeOnTheScreen();
    });

    test('no connection for several checks in a row says so, well before the minute', async () => {
      jest.mocked(getPhotoState).mockRejectedValue(new OfflineError('unreachable'));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      expect(
        await screen.findByText(/No connection to the server/, {}, { timeout: 10_000 }),
      ).toBeOnTheScreen();
      expect(getPhotoState).toHaveBeenCalledTimes(5);
      expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    }, 15_000);

    test('a photo that could not be shrunk is shrunk again, not sent as it is', async () => {
      jest.mocked(shrinkPhoto).mockRejectedValueOnce(new Error('boom'));
      jest
        .mocked(getPhotoState)
        .mockResolvedValue(found([lookItem('White shirt', 'top'), lookItem('Skirt', 'bottom')]));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));
      expect(uploadPhoto).not.toHaveBeenCalled();

      await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('White shirt')).toBeOnTheScreen();
      expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en', 'wear');
    });

    test('a photo that never got there is sent again', async () => {
      jest.mocked(uploadPhoto).mockRejectedValueOnce(new OfflineError('unreachable'));
      jest
        .mocked(getPhotoState)
        .mockResolvedValue(found([lookItem('White shirt', 'top'), lookItem('Skirt', 'bottom')]));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      expect(await screen.findByText(/No connection to the server/)).toBeOnTheScreen();
      expect(getPhotoState).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('White shirt')).toBeOnTheScreen();
      expect(uploadPhoto).toHaveBeenCalledTimes(2);
      // Shrunk already: it isn't done over.
      expect(shrinkPhoto).toHaveBeenCalledTimes(1);
    });

    test('outfits that could not be asked for are asked for again from the same photo', async () => {
      jest.mocked(getPhotoState).mockResolvedValue(found([lookItem('White shirt', 'top')]));
      jest.mocked(askWearWith).mockRejectedValueOnce(new Error('boom'));
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith({
          pathname: '/wear-with/[id]',
          params: { id: 'req-1' },
        }),
      );
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
  });
});
