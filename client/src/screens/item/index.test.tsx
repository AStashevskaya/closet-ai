import type { ItemDetail } from '@closet-ai/shared';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';
import {
  askWearWith,
  deleteItem,
  getItem,
  getSimilarItems,
  getUsage,
  rotateItem,
  updateItem,
} from '@/lib/api';
import { ApiError } from '@/lib/api-error';

import { ItemScreen } from '.';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockBack = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    Stack: { Screen: () => null },
    useRouter: () => ({ back: mockBack, push: mockPush }),
    // Runs the callback once on mount, as if the screen just came into view.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
jest.mock('@/lib/api', () => ({
  getItem: jest.fn(),
  getSimilarItems: jest.fn(),
  updateItem: jest.fn(),
  deleteItem: jest.fn(),
  rotateItem: jest.fn(),
  askWearWith: jest.fn(),
  getUsage: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 'session=1' }),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

// Alert.alert is a native dialog; the spy records it, and tests press its buttons by hand.
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

async function pressAlertButton(text: string) {
  const buttons: AlertButton[] = alert.mock.lastCall?.[2] ?? [];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`No "${text}" button in the dialog`);
  await act(async () => {
    await button.onPress?.();
  });
}

const shirt: ItemDetail = {
  id: '6b1f7c3e-0000-4000-8000-000000000001',
  name: 'White linen shirt',
  category: 'top',
  colors: ['white'],
  seasons: ['spring', 'summer'],
  photoUrl: '/api/items/6b1f7c3e-0000-4000-8000-000000000001/photo',
  photoStatus: 'ready',
  createdAt: '2026-10-19T10:00:00.000Z',
  tags: {
    recognized: true,
    name: 'White linen shirt',
    category: 'top',
    colors: ['white'],
    seasons: ['spring', 'summer'],
    fit: 'relaxed',
    length: null,
    fabric: 'linen',
    style: 'casual',
    brand: null,
    condition: 'good',
    noun: null,
  },
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(getItem).mockResolvedValue(shirt);
  jest.mocked(updateItem).mockImplementation(async (_id, patch) => ({ ...shirt, ...patch }));
  jest.mocked(deleteItem).mockResolvedValue();
  jest.mocked(getSimilarItems).mockResolvedValue([]);
  jest.mocked(getUsage).mockResolvedValue({
    want: { used: 0, limit: 5, resetsAt: '2026-11-01T00:00:00.000Z' },
    look: { used: 0, limit: 3, resetsAt: '2026-11-01T00:00:00.000Z' },
    wear_with: { used: 2, limit: 5, resetsAt: '2026-10-22T00:00:00.000Z' },
  });
});

describe('<ItemScreen />', () => {
  test('shows the item with its seasons and what was read off the photo', async () => {
    await render(<ItemScreen id={shirt.id} />);

    expect(await screen.findByDisplayValue('White linen shirt')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Top' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Summer' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Winter' })).not.toBeChecked();
    // Fit and condition are translated; fabric and style are shown as stored.
    expect(screen.getByText('Relaxed')).toBeOnTheScreen();
    expect(screen.getByText('linen')).toBeOnTheScreen();
    expect(screen.getByText('Good')).toBeOnTheScreen();
    // No brand was legible, so there is no brand row.
    expect(screen.queryByText('Brand')).not.toBeOnTheScreen();
  });

  test('saves corrections, and only once something changed', async () => {
    await render(<ItemScreen id={shirt.id} />);
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    await fireEvent.press(screen.getByText('Winter'));
    await fireEvent.changeText(screen.getByLabelText('Name'), ' Linen shirt ');
    expect(save).toBeEnabled();
    await fireEvent.press(save);

    expect(updateItem).toHaveBeenCalledWith(shirt.id, {
      name: 'Linen shirt',
      category: 'top',
      colors: ['white'],
      seasons: ['spring', 'summer', 'winter'],
      brand: null,
      price: null,
      currency: null,
    });
    expect(mockBack).toHaveBeenCalled();
  });

  test('shows similar items from the wardrobe and opens them', async () => {
    const { tags: _tags, ...base } = shirt;
    jest.mocked(getSimilarItems).mockResolvedValue([
      {
        ...base,
        id: '6b1f7c3e-0000-4000-8000-000000000002',
        name: 'Cream shirt',
        similarity: 0.9,
      },
    ]);
    await render(<ItemScreen id={shirt.id} />);

    expect(await screen.findByText('Similar in your wardrobe')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Cream shirt' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/item/[id]',
      params: { id: '6b1f7c3e-0000-4000-8000-000000000002' },
    });
  });

  test('hides the similar row when there is nothing similar', async () => {
    await render(<ItemScreen id={shirt.id} />);
    await screen.findByDisplayValue('White linen shirt');
    expect(screen.queryByText('Similar in your wardrobe')).not.toBeOnTheScreen();
  });

  test('says when the photo has not been tagged yet', async () => {
    jest.mocked(getItem).mockResolvedValue({ ...shirt, tags: null });
    await render(<ItemScreen id={shirt.id} />);

    expect(
      await screen.findByText('Details appear once the photo has been recognised.'),
    ).toBeOnTheScreen();
  });

  test('deletes the item after asking', async () => {
    await render(<ItemScreen id={shirt.id} />);
    await fireEvent.press(await screen.findByText('Delete item'));
    expect(deleteItem).not.toHaveBeenCalled();

    await pressAlertButton('Delete');
    expect(deleteItem).toHaveBeenCalledWith(shirt.id);
    expect(mockBack).toHaveBeenCalled();
  });

  test('offers to retry when the item could not be loaded', async () => {
    jest.mocked(getItem).mockRejectedValueOnce(new Error('offline'));
    await render(<ItemScreen id={shirt.id} />);

    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByDisplayValue('White linen shirt')).toBeOnTheScreen();
  });
  test('turns the photo and keeps unsaved corrections', async () => {
    const turnedUrl = `/api/items/${shirt.id}/photo?v=turned`;
    jest.mocked(rotateItem).mockResolvedValue({ ...shirt, photoUrl: turnedUrl });
    await render(<ItemScreen id={shirt.id} />);
    await fireEvent.changeText(await screen.findByLabelText('Name'), 'Linen shirt');
    await fireEvent.press(screen.getByLabelText('Rotate photo'));

    expect(rotateItem).toHaveBeenCalledWith(shirt.id);
    expect(await screen.findByDisplayValue('Linen shirt')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByTestId('item-photo')).toHaveProp('source', [
      expect.objectContaining({ uri: `http://api.test${turnedUrl}` }),
    ]);
  });
  test('asks what to wear the item with and opens the outfits', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<ItemScreen id={shirt.id} />);
    expect(await screen.findByText('3 of 5 left today')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'What do I wear this with?' }));

    expect(askWearWith).toHaveBeenCalledWith({ itemId: shirt.id }, 'en');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/wear-with/[id]', params: { id: 'req-1' } });
  });

  test('asks in the mood picked, and in any mood once it is taken back', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<ItemScreen id={shirt.id} />);
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Evening' }));
    await fireEvent.press(screen.getByRole('button', { name: 'What do I wear this with?' }));
    expect(askWearWith).toHaveBeenLastCalledWith({ itemId: shirt.id, mood: 'evening' }, 'en');

    await fireEvent.press(screen.getByRole('checkbox', { name: 'Evening' }));
    await fireEvent.press(screen.getByRole('button', { name: 'What do I wear this with?' }));
    expect(askWearWith).toHaveBeenLastCalledWith({ itemId: shirt.id }, 'en');
  });

  test("says so when today's outfits are used up", async () => {
    jest.mocked(askWearWith).mockRejectedValue(new ApiError(429, 'limit:wear_with'));
    await render(<ItemScreen id={shirt.id} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'What do I wear this with?' }));

    expect(alert).toHaveBeenCalledWith("That's 5 for today. Ask again tomorrow.");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
