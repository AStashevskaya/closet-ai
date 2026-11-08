import type { LookItem, PhotoState } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { AccessibilityInfo } from 'react-native';

import i18n from '@/i18n';
import { askWearWith, getPhotoState, getUsage, uploadPhoto } from '@/lib/api';
import { ApiError, OfflineError } from '@/lib/api-error';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { WearWithPick } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
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

const found = (items: LookItem[]): PhotoState => ({
  status: 'ready',
  tagStatus: 'done',
  tags: null,
  lookItems: items,
  matches: null,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///shot.png', width: 1170, height: 2532 }],
  } as never);
  jest.mocked(shrinkPhoto).mockResolvedValue('file:///small.jpg');
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/wear.webp');
  jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
  jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
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

  describe('waiting in place', () => {
    const unread: PhotoState = {
      status: 'failed',
      tagStatus: 'failed',
      tags: null,
      lookItems: null,
      matches: null,
    };

    test('the photo stays with the bead on its thread while the pieces are found', async () => {
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

    test('a photo the server gave up on goes dashed and only offers another', async () => {
      jest.mocked(getPhotoState).mockResolvedValueOnce(unread);
      await render(<WearWithPick />);
      await fireEvent.press(screen.getByText('Choose from gallery'));

      expect(await screen.findByText("Couldn't read this photo. Try again.")).toBeOnTheScreen();
      expect(
        screen.getByTestId('thread-unread', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
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
