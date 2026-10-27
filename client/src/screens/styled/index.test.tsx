import type { WearWithRequest } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { askWearWith, getUsage, getWearWith } from '@/lib/api';

import { Styled, styledParams } from '.';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  askWearWith: jest.fn(),
  getWearWith: jest.fn(),
  reactToOutfit: jest.fn(),
  getUsage: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 'session=1' }),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

const piece = { id: 'item-1', name: 'Satin midi skirt', photoUrl: '/api/items/item-1/photo' };

const looks = (id: string): WearWithRequest => ({
  id,
  status: 'done',
  addable: null,
  verdict: null,
  wishId: null,
  outfits: [
    {
      id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a90',
      caption: 'Сатин после спорта',
      occasion: 'weekend in town',
      why: 'The tee makes the satin offhand.',
      missing: null,
      pieces: [],
      opinion: null,
      woreCount: 0,
    },
  ],
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
});

describe('<Styled />', () => {
  test('hangs the piece on the thread at once and grows its outfits', async () => {
    jest.mocked(getWearWith).mockImplementation(async (id) => looks(id));
    await render(<Styled requestId="req-1" piece={piece} mood={null} />);
    expect(screen.getByRole('header', { name: 'Outfits with Satin midi skirt' })).toBeOnTheScreen();
    expect(await screen.findByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(getWearWith).toHaveBeenCalledWith('req-1', 'en');
  });

  test('asks about the piece afresh, in the same mood, when the outfits failed', async () => {
    jest
      .mocked(getWearWith)
      .mockResolvedValueOnce({ ...looks('req-1'), status: 'failed', outfits: [] })
      .mockImplementation(async (id) => looks(id));
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-2' });
    await render(<Styled requestId="req-1" piece={piece} mood="evening" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));

    expect(askWearWith).toHaveBeenCalledWith({ itemId: 'item-1', mood: 'evening' }, 'en');
    await waitFor(() => expect(getWearWith).toHaveBeenCalledWith('req-2', 'en'));
    expect(await screen.findByText('The tee makes the satin offhand.')).toBeOnTheScreen();
  });
});

test('styledParams leaves out what the piece lacks', () => {
  expect(styledParams('req-1', { id: 'item-1', name: 'Skirt', photoUrl: '/p' }, null)).toEqual({
    id: 'req-1',
    item: 'item-1',
    name: 'Skirt',
    photoUrl: '/p',
  });
  expect(styledParams('req-1', { id: 'item-1', name: 'Skirt' }, 'office')).toEqual({
    id: 'req-1',
    item: 'item-1',
    name: 'Skirt',
    mood: 'office',
  });
});
