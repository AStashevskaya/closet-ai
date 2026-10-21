import type { LookItem, PhotoState } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { askWearWith, getPhotoState, getUsage, uploadPhoto } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
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

    expect(await screen.findByText("That's 5 for today. Ask again tomorrow.")).toBeOnTheScreen();
  });
});
