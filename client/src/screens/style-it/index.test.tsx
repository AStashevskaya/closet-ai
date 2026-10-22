import type { Item, StyledEntry } from '@closet-ai/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import i18n from '@/i18n';
import { askWearWith, getUsage, listItems, listStyled } from '@/lib/api';
import { ApiError } from '@/lib/api-error';

import { StyleIt } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    // Runs the callback once on mount, as if the tab just came into view.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  listItems: jest.fn(),
  listStyled: jest.fn(),
  askWearWith: jest.fn(),
  getUsage: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 'session=1' }),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const skirt: Item = {
  id: '6b1f7c3e-0000-4000-8000-000000000001',
  name: 'Satin midi skirt',
  category: 'bottom',
  colors: ['beige'],
  seasons: ['autumn'],
  photoUrl: '/api/items/skirt/photo',
  photoStatus: 'ready',
  createdAt: '2026-10-20T10:00:00.000Z',
};
const styled: StyledEntry = {
  id: '6b1f7c3e-0000-4000-8000-0000000000aa',
  createdAt: '2026-10-21T10:00:00.000Z',
  mood: 'evening',
  name: 'Leather jacket',
  photoUrl: '/api/wear-with/aa/photo',
  cutoutUrl: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(listItems).mockResolvedValue([skirt]);
  jest.mocked(listStyled).mockResolvedValue([styled]);
  jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
});

describe('<StyleIt />', () => {
  test('styles a closet piece in the mood picked and opens its outfits', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<StyleIt />);
    await fireEvent.press(screen.getByText('Evening'));
    await fireEvent.press(
      await screen.findByLabelText('What do I wear this with? Satin midi skirt'),
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/wear-with/[id]',
        params: { id: 'req-1' },
      }),
    );
    expect(askWearWith).toHaveBeenCalledWith({ itemId: skirt.id, mood: 'evening' }, 'en');
  });

  test('opens a piece from a photo, and outfits asked for before', async () => {
    await render(<StyleIt />);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo' }));
    expect(mockPush).toHaveBeenCalledWith('/wear-with-pick');

    await fireEvent.press(await screen.findByLabelText('Outfits with Leather jacket'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wear-with/[id]',
      params: { id: styled.id },
    });
  });

  test('says when the outfits are off', async () => {
    jest.mocked(askWearWith).mockRejectedValue(new ApiError(503, 'outfits are off'));
    await render(<StyleIt />);
    await fireEvent.press(
      await screen.findByLabelText('What do I wear this with? Satin midi skirt'),
    );
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Looks aren't available right now."));
  });

  test('asks for a few pieces first when the closet is empty', async () => {
    jest.mocked(listItems).mockResolvedValue([]);
    await render(<StyleIt />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add an item' }));
    expect(mockPush).toHaveBeenCalledWith('/add-item');
  });
});
