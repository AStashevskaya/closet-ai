import type { Item, WearWithRequest } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { getWearWith, reactToOutfit } from '@/lib/api';

import { WearWith } from '.';

jest.mock('@/lib/api', () => ({
  getWearWith: jest.fn(),
  reactToOutfit: jest.fn(),
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
  outfits: [
    {
      id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a90',
      caption: 'Сатин после спорта',
      occasion: 'weekend in town',
      why: 'The tee makes the satin offhand.',
      missing: { category: 'shoes', description: 'chunky white sneakers' },
      pieces: [
        { hero: true, item: skirt },
        { hero: false, item: tee },
        // A piece deleted since is left out.
        { hero: false, item: null },
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
      .mockResolvedValueOnce({ id: 'req-1', status: 'pending', outfits: [] })
      .mockResolvedValue(done);
    await render(<WearWith id="req-1" />);
    expect(screen.getByText('Putting looks together from your closet…')).toBeOnTheScreen();

    expect(
      await screen.findByLabelText('Сатин после спорта', {}, { timeout: 4000 }),
    ).toBeOnTheScreen();
    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(screen.getByText('Mauve satin skirt · Grey tee')).toBeOnTheScreen();
    expect(screen.getByText('Missing: chunky white sneakers')).toBeOnTheScreen();
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
    jest.mocked(getWearWith).mockResolvedValue({ id: 'req-1', status: 'failed', outfits: [] });
    await render(<WearWith id="req-1" />);
    expect(await screen.findByText("Couldn't put looks together. Try again.")).toBeOnTheScreen();
  });
});
