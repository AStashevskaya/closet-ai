import type { Item } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';
import { deleteItem, listItems } from '@/lib/api';

import { Closet } from '.';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    Link: ({ children }: { children: unknown }) => children,
    useRouter: () => ({ push: mockPush }),
    // Runs the callback once on mount, as if the tab just came into view.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
jest.mock('@/lib/api', () => ({
  listItems: jest.fn(),
  deleteItem: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 'session=1' }),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

const list = jest.mocked(listItems);
const remove = jest.mocked(deleteItem);
// Alert.alert is a native dialog; the spy records it, and tests press its buttons by hand.
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

// Presses a button of the last dialog, the way the user would tap it.
async function pressAlertButton(text: string) {
  const buttons: AlertButton[] = alert.mock.lastCall?.[2] ?? [];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`No "${text}" button in the dialog`);
  await act(async () => {
    button.onPress?.();
  });
}

const shirt: Item = {
  id: '6b1f7c3e-0000-4000-8000-000000000001',
  name: 'White linen shirt',
  category: 'top',
  colors: ['white'],
  seasons: [],
  photoUrl: '/api/items/6b1f7c3e-0000-4000-8000-000000000001/photo',
  createdAt: '2026-10-18T10:00:00.000Z',
};

const jeans: Item = {
  ...shirt,
  id: '6b1f7c3e-0000-4000-8000-000000000002',
  name: 'Blue jeans',
  category: 'bottom',
  photoUrl: '/api/items/6b1f7c3e-0000-4000-8000-000000000002/photo',
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<Closet />', () => {
  test('hangs each item on the rail of its category', async () => {
    list.mockResolvedValue([shirt]);
    await render(<Closet />);

    expect(await screen.findByRole('button', { name: 'White linen shirt' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Tops, 1 item' })).toBeOnTheScreen();
  });

  test('invites to add the first item when the closet is empty', async () => {
    list.mockResolvedValue([]);
    await render(<Closet />);

    expect(await screen.findByText(/Your closet is empty/)).toBeOnTheScreen();
  });

  test('offers to retry after a failed load', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([shirt]);
    await render(<Closet />);

    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByRole('button', { name: 'White linen shirt' })).toBeOnTheScreen();
  });

  test('renders the title in Russian', async () => {
    list.mockResolvedValue([]);
    await i18n.changeLanguage('ru');
    await render(<Closet />);

    expect(await screen.findByText('Мой гардероб')).toBeOnTheScreen();
  });

  describe('rails', () => {
    test('one per category the closet has, in the canonical order', async () => {
      list.mockResolvedValue([jeans, shirt]);
      await render(<Closet />);

      const headers = await screen.findAllByRole('header', { name: /, 1 item$/ });
      expect(headers.map((header) => header.props.accessibilityLabel)).toEqual([
        'Tops, 1 item',
        'Bottoms, 1 item',
      ]);
      // No dresses in this closet, so no rail for them.
      expect(screen.queryByText('Dresses')).not.toBeOnTheScreen();
    });

    test('See all opens the whole category', async () => {
      list.mockResolvedValue([shirt, jeans]);
      await render(<Closet />);

      await fireEvent.press(await screen.findByRole('button', { name: 'See all Bottoms' }));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/closet/[category]',
        params: { category: 'bottom' },
      });
    });

    test('a rail goes when its last item is deleted', async () => {
      list.mockResolvedValue([shirt, jeans]);
      remove.mockResolvedValue();
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete Blue jeans' }));
      await pressAlertButton('Delete');

      await waitFor(() => expect(screen.queryByText('Bottoms')).not.toBeOnTheScreen());
      expect(screen.getByRole('button', { name: 'White linen shirt' })).toBeOnTheScreen();
    });
  });

  test('checks again until a new photo has been processed', async () => {
    list
      .mockResolvedValueOnce([{ ...shirt, photoUrl: undefined, photoStatus: 'processing' }])
      .mockResolvedValue([{ ...shirt, photoStatus: 'ready' }]);
    await render(<Closet />);

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2), { timeout: 3000 });
    // Ready now, so no further polling.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(list).toHaveBeenCalledTimes(2);
  });

  test('checks again until a new photo has its cut-out', async () => {
    const fresh = { ...shirt, photoStatus: 'ready' as const, createdAt: new Date().toISOString() };
    list
      .mockResolvedValueOnce([fresh])
      .mockResolvedValue([{ ...fresh, cutoutUrl: `${shirt.photoUrl}?variant=cutout` }]);
    await render(<Closet />);

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(list).toHaveBeenCalledTimes(2);
  });

  test('opens the item screen from a piece, except in edit mode', async () => {
    list.mockResolvedValue([shirt]);
    await render(<Closet />);

    await fireEvent.press(await screen.findByRole('button', { name: 'White linen shirt' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/item/[id]', params: { id: shirt.id } });

    mockPush.mockClear();
    await fireEvent.press(screen.getByText('Edit'));
    await fireEvent.press(screen.getByRole('button', { name: 'White linen shirt' }));
    expect(mockPush).not.toHaveBeenCalled();
  });

  describe('deleting an item', () => {
    test('Edit shows a delete button on each piece, Done hides it', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      expect(screen.getByRole('button', { name: 'Delete White linen shirt' })).toBeOnTheScreen();

      await fireEvent.press(screen.getByText('Done'));
      expect(
        screen.queryByRole('button', { name: 'Delete White linen shirt' }),
      ).not.toBeOnTheScreen();
    });

    test('a long press on a piece starts editing', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      await fireEvent(
        await screen.findByRole('button', { name: 'White linen shirt' }),
        'longPress',
      );
      expect(screen.getByRole('button', { name: 'Delete White linen shirt' })).toBeOnTheScreen();
      expect(alert).not.toHaveBeenCalled();
    });

    test('asks first, then removes the item', async () => {
      list.mockResolvedValue([shirt]);
      remove.mockResolvedValue();
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete White linen shirt' }));
      expect(alert).toHaveBeenCalledWith(
        'Delete “White linen shirt”?',
        expect.any(String),
        expect.any(Array),
      );
      expect(remove).not.toHaveBeenCalled();

      await pressAlertButton('Delete');
      expect(remove).toHaveBeenCalledWith(shirt.id);
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'White linen shirt' })).not.toBeOnTheScreen(),
      );
      // With nothing left to edit, the Edit button goes away too.
      expect(screen.queryByText('Done')).not.toBeOnTheScreen();
    });

    test('keeps the item when the user cancels', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete White linen shirt' }));
      await pressAlertButton('Cancel');

      expect(remove).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'White linen shirt' })).toBeOnTheScreen();
    });

    test('keeps the item and says so when the delete fails', async () => {
      list.mockResolvedValue([shirt]);
      remove.mockRejectedValue(new Error('offline'));
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete White linen shirt' }));
      await pressAlertButton('Delete');

      expect(alert).toHaveBeenLastCalledWith("Couldn't delete the item. Try again.");
      expect(screen.getByRole('button', { name: 'White linen shirt' })).toBeOnTheScreen();
    });

    test('is available to screen readers as an action', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      const piece = await screen.findByRole('button', { name: 'White linen shirt' });
      await fireEvent(piece, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
      expect(alert).toHaveBeenCalledWith(
        'Delete “White linen shirt”?',
        expect.any(String),
        expect.any(Array),
      );
    });
  });
  test('features the newest item on the bright block once the closet has a few', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...shirt,
      id: `6b1f7c3e-0000-4000-8000-00000000001${i}`,
      name: `Item ${i}`,
    }));
    jest.mocked(listItems).mockResolvedValue(many);
    await render(<Closet />);
    const block = await screen.findByRole('button', { name: 'New in your closet: Item 0' });
    await fireEvent.press(block);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/item/[id]', params: { id: many[0]!.id } });
  });
});
