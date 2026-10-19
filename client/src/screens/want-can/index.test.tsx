import type { Item, LookItem, PhotoState } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { getPhotoState, uploadPhoto } from '@/lib/api';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { WantCan } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
  uploadPhoto: jest.fn(),
  getPhotoState: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const screenshot = {
  canceled: false,
  assets: [{ uri: 'file:///screenshot.png', width: 1170, height: 2532 }],
};

const lookItem = (name: string, category: LookItem['category']): LookItem => ({
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

const myTop: Item = {
  id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a87',
  name: 'Dusty pink tank',
  category: 'top',
  colors: ['pink'],
  seasons: ['summer'],
  photoUrl: '/api/items/6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a87/photo',
  photoStatus: 'ready',
  createdAt: '2026-10-19T10:00:00.000Z',
};

const pending: PhotoState = {
  status: 'ready',
  tagStatus: 'pending',
  tags: null,
  lookItems: null,
  matches: null,
};

const matched: PhotoState = {
  status: 'ready',
  tagStatus: 'done',
  tags: null,
  lookItems: [lookItem('Pink mesh top', 'top'), lookItem('Black leather skirt', 'bottom')],
  matches: [
    { how: 'same', item: myTop },
    { how: 'none', item: null },
  ],
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue(screenshot as never);
  jest.mocked(shrinkPhoto).mockResolvedValue('file:///small.jpg');
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/want.webp');
});

describe('<WantCan />', () => {
  test('uploads the screenshot as a want look and shows what the wardrobe has', async () => {
    jest.mocked(getPhotoState).mockResolvedValueOnce(pending).mockResolvedValue(matched);
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));

    expect(uploadPhoto).toHaveBeenCalledWith('file:///small.jpg', 'en', 'want');
    expect(screen.getByText('Finding the items and checking your closet…')).toBeOnTheScreen();
    expect(await screen.findByText('You have 1 of 2', {}, { timeout: 3000 })).toBeOnTheScreen();
    expect(screen.getByText('Pink mesh top')).toBeOnTheScreen();
    expect(screen.getByText('You have it')).toBeOnTheScreen();
    expect(screen.getByText('Dusty pink tank')).toBeOnTheScreen();
    expect(screen.getByText('Black leather skirt')).toBeOnTheScreen();
    expect(screen.getByText('Not in your closet')).toBeOnTheScreen();
  });

  test('opens the matched wardrobe item', async () => {
    jest.mocked(getPhotoState).mockResolvedValue(matched);
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));
    await fireEvent.press(await screen.findByText('Dusty pink tank'));

    expect(mockPush).toHaveBeenCalledWith(`/item/${myTop.id}`);
  });

  test('says so when the screenshot could not be read', async () => {
    jest.mocked(getPhotoState).mockResolvedValue({ ...pending, tagStatus: 'failed' });
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));

    expect(await screen.findByText("Couldn't read the screenshot. Try again.")).toBeOnTheScreen();
    expect(screen.getByText('Choose another screenshot')).toBeOnTheScreen();
  });
});
