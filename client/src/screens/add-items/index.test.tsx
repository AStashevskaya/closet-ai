import type { ItemTags, PhotoState } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { rotatePhoto, shrinkPhoto } from '@/lib/shrink-photo';

import { AddItems, type PickedPhoto } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();
let mockParams: { photos?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
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
  getPhotoState: jest.fn(),
}));

const photos: PickedPhoto[] = [
  { uri: 'file:///shirt.heic', width: 3024, height: 4032 },
  { uri: 'file:///jeans.heic', width: 3024, height: 4032 },
  { uri: 'file:///blur.heic', width: 3024, height: 4032 },
];

const tags = (name: string, category: ItemTags['category']): ItemTags => ({
  recognized: true,
  name,
  category,
  colors: ['white'],
  seasons: ['summer'],
  fit: null,
  length: null,
  fabric: null,
  style: null,
  brand: null,
  condition: null,
  noun: null,
});

const state = (result: ItemTags): PhotoState => ({
  status: 'ready',
  tagStatus: 'done',
  tags: result,
  lookItems: null,
  matches: null,
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  mockParams = { photos: JSON.stringify(photos) };
  jest.mocked(shrinkPhoto).mockImplementation(async ({ uri }) => uri.replace('.heic', '.jpg'));
  jest.mocked(uploadPhoto).mockImplementation(async (uri) => `photos/u1/${uri.split('/').pop()}`);
  jest.mocked(getPhotoState).mockImplementation(async (key) => {
    if (key.includes('shirt')) return state(tags('White shirt', 'top'));
    if (key.includes('jeans')) return state(tags('Blue jeans', 'bottom'));
    return state({ ...tags('', 'top'), recognized: false });
  });
  jest.mocked(rotatePhoto).mockImplementation(async (uri) => uri.replace('.jpg', '-turned.jpg'));
  jest.mocked(createItem).mockResolvedValue({} as never);
});

describe('<AddItems />', () => {
  test('uploads every photo and adds the recognised ones with their tags', async () => {
    await render(<AddItems />);

    expect(await screen.findByText('White shirt')).toBeOnTheScreen();
    expect(screen.getByText('Blue jeans')).toBeOnTheScreen();
    expect(await screen.findByText("Couldn't recognise it — add it on its own")).toBeOnTheScreen();
    expect(uploadPhoto).toHaveBeenCalledTimes(3);
    expect(uploadPhoto).toHaveBeenCalledWith('file:///shirt.jpg', 'en');

    await fireEvent.press(screen.getByText('Add 2 pieces'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(createItem).toHaveBeenCalledWith({
      name: 'White shirt',
      category: 'top',
      colors: ['white'],
      seasons: ['summer'],
      photoKey: 'photos/u1/shirt.jpg',
      brand: null,
      price: null,
      currency: null,
    });
  });

  test('leaves out an unticked photo', async () => {
    await render(<AddItems />);
    await screen.findByText('Blue jeans');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Blue jeans' }));
    await screen.findByText("Couldn't recognise it — add it on its own");
    await fireEvent.press(screen.getByText('Add 1 piece'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'White shirt' }));
  });

  test('keeps the items that failed to save, ready to try again', async () => {
    jest
      .mocked(createItem)
      .mockImplementation(async ({ name }) =>
        name === 'Blue jeans' ? Promise.reject(new Error('offline')) : ({} as never),
      );
    await render(<AddItems />);
    await screen.findByText("Couldn't recognise it — add it on its own");
    await screen.findByText('Blue jeans');
    await fireEvent.press(screen.getByText('Add 2 pieces'));

    expect(await screen.findByText("Couldn't add some of the items. Try again.")).toBeOnTheScreen();
    expect(screen.getByText('Added')).toBeOnTheScreen();
    expect(screen.getByText('Add 1 piece')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });
  test('saves what was corrected in the list', async () => {
    await render(<AddItems />);
    await screen.findByText("Couldn't recognise it — add it on its own");
    await fireEvent.press(await screen.findByLabelText('Edit Blue jeans'));
    await fireEvent.changeText(screen.getByDisplayValue('Blue jeans'), 'Wide-leg jeans');
    await fireEvent.press(screen.getByText('Blue'));
    await fireEvent.press(screen.getByText('Add 2 pieces'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Wide-leg jeans', colors: ['white', 'blue'] }),
    );
  });

  test('asks for a name before saving an item whose name was cleared', async () => {
    await render(<AddItems />);
    await screen.findByText("Couldn't recognise it — add it on its own");
    await fireEvent.press(await screen.findByLabelText('Edit White shirt'));
    await fireEvent.changeText(screen.getByDisplayValue('White shirt'), ' ');
    await fireEvent.press(screen.getByText('Add 2 pieces'));

    expect(
      screen.getByText('Fill in a name and at least one color for each ticked item'),
    ).toBeOnTheScreen();
    expect(createItem).not.toHaveBeenCalled();
  });

  test('uploads a turned copy of a recognised photo and keeps its fields', async () => {
    await render(<AddItems />);
    await screen.findByText("Couldn't recognise it — add it on its own");
    await screen.findByText('White shirt');
    await fireEvent.press(screen.getAllByLabelText('Rotate photo')[0]!);

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith('file:///shirt-turned.jpg', 'en'));
    await waitFor(() => expect(screen.getByText('Add 2 pieces')).toBeEnabled());
    await fireEvent.press(screen.getByText('Add 2 pieces'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'White shirt', photoKey: 'photos/u1/shirt-turned.jpg' }),
    );
  });

  test('tags an unrecognised photo again once it is turned', async () => {
    jest.mocked(getPhotoState).mockImplementation(async (key) => {
      if (key.includes('blur-turned')) return state(tags('Grey cardigan', 'outerwear'));
      if (key.includes('shirt')) return state(tags('White shirt', 'top'));
      if (key.includes('jeans')) return state(tags('Blue jeans', 'bottom'));
      return state({ ...tags('', 'top'), recognized: false });
    });
    await render(<AddItems />);
    await screen.findByText("Couldn't recognise it — add it on its own");
    await screen.findByText('Blue jeans');
    const buttons = screen.getAllByLabelText('Rotate photo');
    await fireEvent.press(buttons[buttons.length - 1]!);

    expect(await screen.findByText('Grey cardigan')).toBeOnTheScreen();
    expect(screen.getByText('Add 3 pieces')).toBeOnTheScreen();
  });
});
