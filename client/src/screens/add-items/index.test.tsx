import type { ItemTags, PhotoState } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { createItem, getPhotoState, uploadPhoto } from '@/lib/api';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { AddItems, type PickedPhoto } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();
let mockParams: { photos?: string } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
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

    await fireEvent.press(screen.getByText('Add 2 items'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(createItem).toHaveBeenCalledTimes(2);
    expect(createItem).toHaveBeenCalledWith({
      name: 'White shirt',
      category: 'top',
      colors: ['white'],
      seasons: ['summer'],
      photoKey: 'photos/u1/shirt.jpg',
    });
  });

  test('leaves out an unticked photo', async () => {
    await render(<AddItems />);
    await fireEvent.press(await screen.findByText('Blue jeans'));
    await screen.findByText("Couldn't recognise it — add it on its own");
    await fireEvent.press(screen.getByText('Add 1 item'));

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
    await fireEvent.press(screen.getByText('Add 2 items'));

    expect(await screen.findByText("Couldn't add some of the items. Try again.")).toBeOnTheScreen();
    expect(screen.getByText('Added')).toBeOnTheScreen();
    expect(screen.getByText('Add 1 item')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
