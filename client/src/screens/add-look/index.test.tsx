import type { LookItem } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
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
  // No usage unless a test gives one: the screens then show no counts.
  getUsage: jest.fn().mockRejectedValue(new Error('offline')),
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
  noun: null,
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

// The marks, the thread and the measuring copies are hidden from screen readers.
const hidden = { includeHiddenElements: true };

// Labels are placed once their sizes are known; Jest has no layout, so it is given here.
async function measureLabels() {
  for (const label of screen.getAllByTestId('measure-label', hidden)) {
    await fireEvent(label, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 96, height: 28 } },
    });
  }
}

async function findPieces() {
  findAfterOnePoll(found);
  await render(<AddLook />);
  await fireEvent.press(screen.getByText('Choose from gallery'));
  await screen.findByText('Found 2 pieces — tap one to leave it out', {}, { timeout: 3000 });
  await measureLabels();
}

describe('<AddLook />', () => {
  test('uploads the selfie as a look and marks the pieces found on it', async () => {
    findAfterOnePoll(found);
    await render(<AddLook />);
    await fireEvent.press(screen.getByText('Choose from gallery'));

    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en', 'look');
    // Waiting: the same screen, a bead running along the look's thread.
    expect(screen.getByText('Looking for the items you’re wearing…')).toBeOnTheScreen();
    expect(screen.getByTestId('thread-waiting', hidden)).toBeOnTheScreen();

    expect(
      await screen.findByText('Found 2 pieces — tap one to leave it out', {}, { timeout: 3000 }),
    ).toBeOnTheScreen();
    await measureLabels();
    expect(
      screen.getByRole('checkbox', { name: 'Pink tweed top', checked: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('checkbox', { name: 'White sandals', checked: true }),
    ).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^loop-/, hidden)).toHaveLength(2);
    expect(screen.getAllByTestId('bead-on', hidden)).toHaveLength(2);
    expect(screen.getByText('Add 2 pieces')).toBeOnTheScreen();
  });

  test('a tap on a label or a loop leaves the piece out', async () => {
    await findPieces();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'White sandals' }));
    expect(
      screen.getByRole('checkbox', { name: 'White sandals', checked: false }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Add 1 piece')).toBeOnTheScreen();
    expect(screen.getAllByTestId('bead-off', hidden)).toHaveLength(1);

    await fireEvent.press(screen.getByTestId('loop-0', hidden));
    expect(screen.getByText('Add 0 pieces')).toBeOnTheScreen();
    // And back in.
    await fireEvent.press(screen.getByTestId('loop-0', hidden));
    expect(screen.getByText('Add 1 piece')).toBeOnTheScreen();
  });

  test('adds only the pieces left in, then hangs them up', async () => {
    await findPieces();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'White sandals' }));
    await fireEvent.press(screen.getByText('Add 1 piece'));

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
    // "Hang it up" names the count; a tap closes it at once.
    const caption = await screen.findByText('1 piece in your closet');
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(caption);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  test('says so when saving fails, and keeps the pieces', async () => {
    jest.mocked(addLookItems).mockRejectedValueOnce(new Error('500'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await findPieces();

    await fireEvent.press(screen.getByText('Add 2 pieces'));

    expect(await screen.findByText('Couldn’t add the items. Try again.')).toBeOnTheScreen();
    expect(screen.queryByText('2 pieces in your closet')).not.toBeOnTheScreen();
    expect(screen.getByText('Add 2 pieces')).toBeOnTheScreen();
  });

  test('asks for at least one piece', async () => {
    await findPieces();

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Pink tweed top' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'White sandals' }));
    await fireEvent.press(screen.getByText('Add 0 pieces'));

    expect(screen.getByText('Keep at least one piece')).toBeOnTheScreen();
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
    // Another photo takes the bottom again.
    expect(screen.getByText('Choose from gallery')).toBeOnTheScreen();
  });

  test('says so when the photo can’t be read, the thread left dashed', async () => {
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
    expect(screen.getByTestId('thread-unread', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('thread-waiting', hidden)).not.toBeOnTheScreen();
  });
});
