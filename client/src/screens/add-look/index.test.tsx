import type { LookItem } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { addLookItems, getPhotoState, uploadPhoto } from '@/lib/api';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { AddLook } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
// Leaving needs a real navigator; the screens' own navigations go straight through here.
jest.mock('@/lib/use-confirm-leave', () => ({
  useConfirmLeave: () => (navigate: () => void) => navigate(),
}));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
  uploadPhoto: jest.fn(),
  getPhotoState: jest.fn(),
  addLookItems: jest.fn(),
}));

const selfie = {
  canceled: false,
  assets: [{ uri: 'file:///selfie.heic', width: 900, height: 1600 }],
};

const item = (name: string, category: LookItem['category']): LookItem => ({
  name,
  category,
  colors: ['pink'],
  seasons: ['summer'],
  fit: null,
  length: null,
  fabric: null,
  style: null,
  brand: null,
  condition: null,
  box: { xMin: 0.2, yMin: 0.2, xMax: 0.8, yMax: 0.6 },
});
const found = [item('Pink tweed top', 'top'), item('White sandals', 'shoes')];

// The server answers "still looking" once, then with the items.
function findAfterOnePoll(items: LookItem[]) {
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
      tags: null,
      lookItems: items,
      matches: null,
    });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(selfie as never);
  jest.mocked(shrinkPhoto).mockResolvedValue('file:///small.jpg');
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/look.webp');
  jest.mocked(addLookItems).mockResolvedValue([]);
});

describe('<AddLook />', () => {
  test('uploads the selfie as a look and lists the items found on it', async () => {
    findAfterOnePoll(found);
    await render(<AddLook />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en', 'look');
    expect(screen.getByText('Looking for the items you’re wearing…')).toBeOnTheScreen();
    expect(await screen.findByText('Pink tweed top', {}, { timeout: 3000 })).toBeOnTheScreen();
    expect(screen.getByText('White sandals')).toBeOnTheScreen();
    expect(screen.getByText('Add 2 items')).toBeOnTheScreen();
  });

  test('adds only the items left ticked', async () => {
    findAfterOnePoll(found);
    await render(<AddLook />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await screen.findByText('White sandals', {}, { timeout: 3000 });

    await fireEvent.press(screen.getByRole('checkbox', { name: 'White sandals' }));
    await fireEvent.press(screen.getByText('Add 1 item'));

    expect(addLookItems).toHaveBeenCalledWith({
      photoKey: 'photos/u1/look.webp',
      items: [
        {
          index: 0,
          name: 'Pink tweed top',
          category: 'top',
          colors: ['pink'],
          seasons: ['summer'],
        },
      ],
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  test('asks for at least one item', async () => {
    findAfterOnePoll(found);
    await render(<AddLook />);
    await fireEvent.press(screen.getByText('Choose from gallery'));
    await screen.findByText('White sandals', {}, { timeout: 3000 });

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Pink tweed top' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'White sandals' }));
    await fireEvent.press(screen.getByText('Add 0 items'));

    expect(screen.getByText('Tick at least one item')).toBeOnTheScreen();
    expect(addLookItems).not.toHaveBeenCalled();
  });

  test('says so when there are no clothes on the photo', async () => {
    findAfterOnePoll([]);
    await render(<AddLook />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(
      await screen.findByText(
        'Couldn’t find clothes on this photo. Try another one, full length.',
        {},
        { timeout: 3000 },
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/^Add /)).not.toBeOnTheScreen();
  });

  test('says so when the photo can’t be read', async () => {
    jest.mocked(getPhotoState).mockResolvedValue({
      status: 'ready',
      tagStatus: 'failed',
      tags: null,
      lookItems: null,
      matches: null,
    });
    await render(<AddLook />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(
      await screen.findByText('Couldn’t read this photo. Try again.', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
  });
});
