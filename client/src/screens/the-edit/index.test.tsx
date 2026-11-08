import type { CatalogFeedItem } from '@closet-ai/shared';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { listCatalog } from '@/lib/api';

import { TheEdit } from '.';

const mockPush = jest.fn();
// The effect the screen runs on focus, so a test can come back to the tab.
let mockFocus: () => void = () => {};
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (effect: () => void) => {
      mockFocus = effect;
      useEffect(effect, [effect]);
    },
  };
});
jest.mock('@/lib/api', () => ({
  listCatalog: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const piece = (
  id: string,
  name: string,
  category: CatalogFeedItem['category'],
): CatalogFeedItem => ({
  id,
  brand: 'STUDIO EDIT',
  name,
  category,
  colors: ['black'],
  price: 459,
  currency: 'ILS',
  url: `https://brand.example/p/${id}`,
  imageUrl: `/api/catalog/${id}/photo?v=1`,
  inStock: true,
  demo: true,
  goesWith: null,
});
const boots = piece('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a01', 'Ankle boots', 'shoes');
const tee = piece('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a02', 'Knit top', 'top');

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<TheEdit />', () => {
  test('shows the partner pieces in the order given, labelled, and filters them', async () => {
    jest.mocked(listCatalog).mockResolvedValue([boots, tee]);
    await render(<TheEdit />);

    expect(await screen.findByText('Brands')).toBeOnTheScreen();
    expect(screen.getAllByText('Partner · demo brand')).toHaveLength(2);
    expect(listCatalog).toHaveBeenCalledWith('en');
    expect(
      screen.getAllByRole('button', { name: /STUDIO EDIT/ }).map((b) => b.props.accessibilityLabel),
    ).toEqual(['STUDIO EDIT, Ankle boots, ₪459', 'STUDIO EDIT, Knit top, ₪459']);

    await fireEvent.press(screen.getByText('Tops'));
    expect(screen.queryByText('Ankle boots')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'STUDIO EDIT, Knit top, ₪459' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/catalog/[id]', params: { id: tee.id } });
  });

  test('says so when Brands could not be loaded', async () => {
    jest.mocked(listCatalog).mockRejectedValue(new Error('offline'));
    await render(<TheEdit />);
    expect(await screen.findByText("Couldn't open Brands.")).toBeOnTheScreen();
  });

  test('can try again, and reach Recreate the look, when loading failed', async () => {
    jest.mocked(listCatalog).mockRejectedValueOnce(new Error('offline'));
    jest.mocked(listCatalog).mockResolvedValue([boots]);
    await render(<TheEdit />);
    expect(await screen.findByText('Recreate the look')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('Ankle boots')).toBeOnTheScreen();
  });

  test('coming back reads again, and shows everything when the chosen category has gone', async () => {
    jest.mocked(listCatalog).mockResolvedValue([boots, tee]);
    await render(<TheEdit />);
    await fireEvent.press(await screen.findByText('Tops'));
    expect(screen.queryByText('Ankle boots')).toBeNull();

    jest.mocked(listCatalog).mockResolvedValue([boots]);
    await act(async () => mockFocus());
    expect(await screen.findByText('Ankle boots')).toBeOnTheScreen();
  });

  test('keeps what is on screen when reading again fails', async () => {
    jest.mocked(listCatalog).mockResolvedValue([boots]);
    await render(<TheEdit />);
    await screen.findByText('Ankle boots');

    jest.mocked(listCatalog).mockRejectedValue(new Error('offline'));
    await act(async () => mockFocus());
    expect(screen.getByText('Ankle boots')).toBeOnTheScreen();
  });

  test('says which of her pieces a piece goes with, and only when one does', async () => {
    jest.mocked(listCatalog).mockResolvedValue([
      {
        ...boots,
        goesWith: {
          count: 9,
          piece: { id: 'skirt', name: 'grey skirt', cutoutUrl: '/api/items/skirt/photo' },
        },
      },
      tee,
    ]);
    await render(<TheEdit />);

    expect(await screen.findByText('with your grey skirt')).toBeOnTheScreen();
    expect(screen.getByText('Goes with 9 of your pieces')).toBeOnTheScreen();
    expect(screen.getAllByText(/^with your /)).toHaveLength(1);
    expect(
      screen.getByRole('button', {
        name: 'STUDIO EDIT, Ankle boots, ₪459. with your grey skirt. Goes with 9 of your pieces',
      }),
    ).toBeOnTheScreen();
  });

  test('has a way in to Recreate the look', async () => {
    jest.mocked(listCatalog).mockResolvedValue([boots]);
    await render(<TheEdit />);
    await fireEvent.press(await screen.findByText('Recreate the look'));
    expect(mockPush).toHaveBeenCalledWith('/want-can');
  });
});
