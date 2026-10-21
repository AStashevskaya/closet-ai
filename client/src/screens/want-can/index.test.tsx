import type { Item, LookItem, PhotoState, Usage } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { getPhotoState, getUsage, uploadPhoto } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
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
  // No usage unless a test gives one: the screens then show no counts.
  getUsage: jest.fn().mockRejectedValue(new Error('offline')),
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
  // clearAllMocks keeps implementations, so a test's usage would leak into the next one.
  jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
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
    // The owned pieces, laid out as a collage.
    expect(screen.getByLabelText('From your closet')).toBeOnTheScreen();
  });

  test('leaves the collage out when nothing in the look is owned', async () => {
    jest.mocked(getPhotoState).mockResolvedValue({
      ...matched,
      matches: [
        { how: 'none', item: null },
        { how: 'none', item: null },
      ],
    });
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));

    expect(await screen.findByText('You have 0 of 2')).toBeOnTheScreen();
    expect(screen.queryByLabelText('From your closet')).not.toBeOnTheScreen();
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
  describe('free-tier limit', () => {
    const usage = (used: number): Usage => ({
      want: { used, limit: 5, resetsAt: '2026-11-01T00:00:00.000Z' },
      look: { used: 0, limit: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
    });

    test('shows how many screenshots are left this month', async () => {
      jest.mocked(getUsage).mockResolvedValue(usage(1));
      await render(<WantCan />);
      expect(await screen.findByText('4 of 5 left this month')).toBeOnTheScreen();
    });

    test('says when they come back instead of offering a pick once they are used', async () => {
      jest.mocked(getUsage).mockResolvedValue(usage(5));
      await render(<WantCan />);
      expect(await screen.findByText(/You've used this month's 5 screenshots/)).toBeOnTheScreen();
      expect(screen.queryByText('Choose a screenshot')).not.toBeOnTheScreen();
    });

    test('explains a limit the server reports', async () => {
      jest.mocked(uploadPhoto).mockRejectedValue(new ApiError(429, 'limit:budget'));
      await render(<WantCan />);
      await fireEvent.press(screen.getByText('Choose a screenshot'));
      expect(
        await screen.findByText('The AI is resting for today. Try again tomorrow.'),
      ).toBeOnTheScreen();
    });
  });
});
