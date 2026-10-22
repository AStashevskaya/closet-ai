import type { CatalogItem } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { listCatalog } from '@/lib/api';

import { TheEdit } from '.';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api', () => ({
  listCatalog: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const piece = (id: string, name: string, category: CatalogItem['category']): CatalogItem => ({
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

    expect(await screen.findByText('The Edit')).toBeOnTheScreen();
    expect(screen.getByText('Partner · demo brand')).toBeOnTheScreen();
    expect(listCatalog).toHaveBeenCalledWith('en');
    expect(
      screen.getAllByRole('button', { name: /STUDIO EDIT/ }).map((b) => b.props.accessibilityLabel),
    ).toEqual(['STUDIO EDIT, Ankle boots, ₪459', 'STUDIO EDIT, Knit top, ₪459']);

    await fireEvent.press(screen.getByText('Tops'));
    expect(screen.queryByText('Ankle boots')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'STUDIO EDIT, Knit top, ₪459' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/catalog/[id]', params: { id: tee.id } });
  });

  test('says so when the Edit could not be loaded', async () => {
    jest.mocked(listCatalog).mockRejectedValue(new Error('offline'));
    await render(<TheEdit />);
    expect(await screen.findByText("Couldn't open the Edit. Try again.")).toBeOnTheScreen();
  });
});
