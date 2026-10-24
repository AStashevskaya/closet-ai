import type { CatalogItem } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import i18n from '@/i18n';
import { getCatalogItem } from '@/lib/api';

import { CatalogItemScreen } from '.';

jest.mock('@/lib/api', () => ({
  getCatalogItem: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const boots: CatalogItem = {
  id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a99',
  brand: 'STUDIO EDIT',
  name: 'Ankle boots',
  category: 'shoes',
  colors: ['black'],
  price: 459.5,
  currency: 'ILS',
  url: 'https://brand.example/p/P070',
  imageUrl: '/api/catalog/boots/photo?v=1',
  inStock: true,
  demo: false,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<CatalogItemScreen />', () => {
  test("shows a partner's piece and leads to the brand's site", async () => {
    jest.mocked(getCatalogItem).mockResolvedValue(boots);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue();
    await render(<CatalogItemScreen id={boots.id} />);

    expect(await screen.findByRole('header', { name: 'Ankle boots' })).toBeOnTheScreen();
    expect(screen.getByText('Partner')).toBeOnTheScreen();
    expect(screen.getByText('₪459.50')).toBeOnTheScreen();
    expect(getCatalogItem).toHaveBeenCalledWith(boots.id, 'en');

    await fireEvent.press(screen.getByRole('button', { name: "On the brand's site" }));
    expect(open).toHaveBeenCalledWith(boots.url);
  });

  test("doesn't offer a demo brand's link, and says why", async () => {
    jest.mocked(getCatalogItem).mockResolvedValue({ ...boots, demo: true, inStock: false });
    await render(<CatalogItemScreen id={boots.id} />);

    expect(await screen.findByText('Partner · demo brand')).toBeOnTheScreen();
    expect(screen.getByText(/A made-up brand/)).toBeOnTheScreen();
    expect(screen.getByText('₪459.50 · sold out')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: "On the brand's site" })).toBeNull();
  });

  test('says so when the piece could not be loaded', async () => {
    jest.mocked(getCatalogItem).mockRejectedValue(new Error('offline'));
    await render(<CatalogItemScreen id={boots.id} />);
    expect(await screen.findByText("Couldn't open this piece. Try again.")).toBeOnTheScreen();
  });
});
