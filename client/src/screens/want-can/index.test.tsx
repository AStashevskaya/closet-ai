import type { CatalogItem, Item, LookItem, PhotoState, Usage } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import i18n from '@/i18n';
import { getPhotoState, getUsage, uploadPhoto } from '@/lib/api';
import { ApiError, OfflineError } from '@/lib/api-error';
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
  noun: null,
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
    { how: 'same', item: myTop, shop: [] },
    { how: 'none', item: null, shop: [] },
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
    // A bead per piece: full for hers, dashed for the one she lacks.
    const hidden = { includeHiddenElements: true };
    expect(screen.getAllByTestId('bead-mine', hidden)).toHaveLength(1);
    expect(screen.getAllByTestId('bead-none', hidden)).toHaveLength(1);
    // Behind the curtain (hidden from screen readers, the rows say it): her piece where the
    // look's was, and an empty hanger for the one she lacks.
    await fireEvent(screen.getByTestId('curtain', hidden), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
    expect(screen.getByText('Hers', hidden)).toBeOnTheScreen();
    expect(screen.getAllByTestId('bare-piece', hidden)).toHaveLength(1);
    expect(screen.getAllByTestId('empty-hanger', hidden)).toHaveLength(1);
  });

  test('hangs an empty hanger for every piece when nothing in the look is owned', async () => {
    jest.mocked(getPhotoState).mockResolvedValue({
      ...matched,
      matches: [
        { how: 'none', item: null, shop: [] },
        { how: 'none', item: null, shop: [] },
      ],
    });
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));

    expect(await screen.findByText('You have 0 of 2')).toBeOnTheScreen();
    const hidden = { includeHiddenElements: true };
    await fireEvent(screen.getByTestId('curtain', hidden), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
    expect(screen.getAllByTestId('empty-hanger', hidden)).toHaveLength(2);
    expect(screen.queryAllByTestId('bare-piece', hidden)).toHaveLength(0);
  });

  test('offers partner pieces for what the closet lacks, not for what it has', async () => {
    const offer = (id: string, name: string): CatalogItem => ({
      id,
      brand: 'STUDIO EDIT',
      name,
      category: 'bottom',
      colors: ['black'],
      price: 239,
      currency: 'ILS',
      url: `https://brand.example/p/${id}`,
      imageUrl: `/api/catalog/${id}/photo?v=1`,
      inStock: true,
      demo: true,
    });
    const slit = offer('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a71', 'Slit skirt');
    jest.mocked(getPhotoState).mockResolvedValue({
      ...matched,
      matches: [
        {
          how: 'same',
          item: myTop,
          shop: [offer('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a70', 'Mesh top')],
        },
        { how: 'none', item: null, shop: [slit] },
      ],
    });
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));

    expect(await screen.findByText('Like it from partner brands')).toBeOnTheScreen();
    expect(screen.queryByText('Mesh top')).toBeNull();
    expect(getPhotoState).toHaveBeenCalledWith('photos/u1/want.webp', 'en');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Partner · demo brand: STUDIO EDIT, Slit skirt, ₪239' }),
    );
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/catalog/[id]', params: { id: slit.id } });

    // The empty hanger for the skirt she lacks carries the partner's price.
    const hidden = { includeHiddenElements: true };
    await fireEvent(screen.getByTestId('curtain', hidden), 'layout', {
      nativeEvent: { layout: { width: 390 } },
    });
    expect(screen.getAllByText('₪239', hidden).length).toBeGreaterThan(0);
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
  test('blames the connection, not the screenshot, when the server is unreachable', async () => {
    jest.mocked(uploadPhoto).mockRejectedValue(new OfflineError('Network request failed'));
    await render(<WantCan />);
    await fireEvent.press(screen.getByText('Choose a screenshot'));

    expect(
      await screen.findByText('No connection to the server. Check the internet and try again.'),
    ).toBeOnTheScreen();
  });
  describe('free-tier limit', () => {
    const usage = (used: number): Usage => ({
      want: { used, limit: 5, resetsAt: '2026-11-01T00:00:00.000Z' },
      look: { used: 0, limit: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
      wear_with: { used: 0, limit: 5, resetsAt: '2026-10-22T00:00:00.000Z' },
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
