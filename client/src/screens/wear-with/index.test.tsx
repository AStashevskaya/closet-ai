import type { CatalogItem, Item, WearWithRequest } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { createItem, getWearWith, reactToOutfit } from '@/lib/api';

import { WearWith } from '.';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/lib/api', () => ({
  getWearWith: jest.fn(),
  reactToOutfit: jest.fn(),
  createItem: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const item = (id: string, name: string, category: Item['category']): Item => ({
  id,
  name,
  category,
  colors: ['white'],
  seasons: ['autumn'],
  photoUrl: `/api/items/${id}/photo?v=1`,
  photoStatus: 'ready',
  createdAt: '2026-10-21T10:00:00.000Z',
});

const skirt = item('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a81', 'Mauve satin skirt', 'bottom');
const tee = item('6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a82', 'Grey tee', 'top');

const done: WearWithRequest = {
  id: 'req-1',
  status: 'done',
  addable: null,
  verdict: null,
  outfits: [
    {
      id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a90',
      caption: 'Сатин после спорта',
      occasion: 'weekend in town',
      why: 'The tee makes the satin offhand.',
      missing: { category: 'shoes', description: 'chunky white sneakers' },
      pieces: [
        { hero: true, item: skirt, catalogItem: null },
        { hero: false, item: tee, catalogItem: null },
        // A piece deleted since is left out.
        { hero: false, item: null, catalogItem: null },
      ],
      opinion: null,
      woreCount: 0,
    },
  ],
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(reactToOutfit).mockResolvedValue();
});

describe('<WearWith />', () => {
  test('waits for the outfits, then shows each with what is missing', async () => {
    jest
      .mocked(getWearWith)
      .mockResolvedValueOnce({
        id: 'req-1',
        status: 'pending',
        outfits: [],
        addable: null,
        verdict: null,
      })
      .mockResolvedValue(done);
    await render(<WearWith id="req-1" />);
    expect(screen.getByText('Putting looks together from your closet…')).toBeOnTheScreen();

    expect(
      await screen.findByLabelText('Сатин после спорта', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(screen.getByText('Mauve satin skirt · Grey tee')).toBeOnTheScreen();
    expect(screen.getByText('Missing: chunky white sneakers')).toBeOnTheScreen();
    expect(getWearWith).toHaveBeenCalledWith('req-1', 'en');
  });

  test('labels a partner piece and opens its card', async () => {
    const boots: CatalogItem = {
      id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a99',
      brand: 'STUDIO EDIT',
      name: 'Ankle boots',
      category: 'shoes',
      colors: ['black'],
      price: 459,
      currency: 'ILS',
      url: 'https://brand.example/p/P070',
      imageUrl: '/api/catalog/boots/photo?v=1',
      inStock: true,
      demo: true,
    };
    const look = done.outfits[0]!;
    jest.mocked(getWearWith).mockResolvedValue({
      ...done,
      outfits: [
        {
          ...look,
          missing: null,
          pieces: [...look.pieces, { hero: false, item: null, catalogItem: boots }],
        },
      ],
    });
    await render(<WearWith id="req-1" />);

    const partner = await screen.findByRole('button', {
      name: 'Partner · demo brand: STUDIO EDIT, Ankle boots, ₪459',
    });
    // The closet's pieces stay apart from the partner's.
    expect(screen.getByText('Mauve satin skirt · Grey tee')).toBeOnTheScreen();
    await fireEvent.press(partner);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/catalog/[id]', params: { id: boots.id } });
  });

  test('likes, takes the like back and counts every wear', async () => {
    jest.mocked(getWearWith).mockResolvedValue(done);
    await render(<WearWith id="req-1" />);
    const id = done.outfits[0]!.id;

    await fireEvent.press(await screen.findByRole('button', { name: 'Like' }));
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'like');
    expect(screen.getByRole('button', { name: 'Like' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'none');

    await fireEvent.press(screen.getByRole('button', { name: 'Wore it' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Wore it · 1' }));
    expect(screen.getByRole('button', { name: 'Wore it · 2' })).toBeOnTheScreen();
  });

  test('says so when the outfits could not be put together', async () => {
    jest
      .mocked(getWearWith)
      .mockResolvedValue({
        id: 'req-1',
        status: 'failed',
        outfits: [],
        addable: null,
        verdict: null,
      });
    await render(<WearWith id="req-1" />);
    expect(await screen.findByText("Couldn't put looks together. Try again.")).toBeOnTheScreen();
  });
  test('says whether a piece is worth buying, and opens the one she already has', async () => {
    jest.mocked(getWearWith).mockResolvedValue({
      ...done,
      verdict: { call: 'skip', reason: 'Almost your grey tee again.', twin: tee },
    });
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText('Skip it')).toBeOnTheScreen();
    expect(screen.getByText('Almost your grey tee again.')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: 'You already have one like it: Grey tee' }),
    );
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/item/[id]', params: { id: tee.id } });
  });

  test('adds an item from a photo to the closet', async () => {
    const addable = {
      name: 'Red leather skirt',
      category: 'bottom' as const,
      colors: ['red' as const],
      seasons: ['autumn' as const],
      photoKey: 'photos/u1/crop.webp',
    };
    jest.mocked(getWearWith).mockResolvedValue({ ...done, addable });
    jest.mocked(createItem).mockResolvedValue({} as never);
    await render(<WearWith id="req-1" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to my closet' }));

    expect(createItem).toHaveBeenCalledWith(addable);
    expect(await screen.findByText('In your closet')).toBeOnTheScreen();
  });
});
