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
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    Link: ({ children }: { children: unknown }) => children,
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
  test('shows the items with their category', async () => {
    list.mockResolvedValue([shirt]);
    await render(<Closet />);

    expect(await screen.findByText('White linen shirt')).toBeOnTheScreen();
    expect(screen.getByText('Top')).toBeOnTheScreen();
  });

  test('invites to add the first item when the closet is empty', async () => {
    list.mockResolvedValue([]);
    await render(<Closet />);

    expect(await screen.findByText(/Your closet is empty/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeOnTheScreen();
  });

  test('offers to retry after a failed load', async () => {
    list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([shirt]);
    await render(<Closet />);

    await fireEvent.press(await screen.findByText('Try again'));
    expect(await screen.findByText('White linen shirt')).toBeOnTheScreen();
  });

  test('renders the title in Russian', async () => {
    list.mockResolvedValue([]);
    await i18n.changeLanguage('ru');
    await render(<Closet />);

    expect(await screen.findByText('Мой гардероб')).toBeOnTheScreen();
  });

  describe('filtering by category', () => {
    test('shows a chip per category the closet has, and filters the grid', async () => {
      list.mockResolvedValue([shirt, jeans]);
      await render(<Closet />);

      await screen.findByText('White linen shirt');
      expect(screen.getByRole('button', { name: 'All', selected: true })).toBeOnTheScreen();
      // No dresses in this closet, so no chip for them.
      expect(screen.queryByText('Dresses')).not.toBeOnTheScreen();

      await fireEvent.press(screen.getByText('Bottoms'));
      expect(screen.getByRole('button', { name: 'Bottoms', selected: true })).toBeOnTheScreen();
      expect(screen.getByText('Blue jeans')).toBeOnTheScreen();
      expect(screen.queryByText('White linen shirt')).not.toBeOnTheScreen();

      await fireEvent.press(screen.getByText('All'));
      expect(screen.getByText('White linen shirt')).toBeOnTheScreen();
      expect(screen.getByText('Blue jeans')).toBeOnTheScreen();
    });

    test('is hidden when everything is in one category', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      await screen.findByText('White linen shirt');
      expect(screen.queryByText('All')).not.toBeOnTheScreen();
    });

    test('goes back to all items when the last one of the chosen category is deleted', async () => {
      list.mockResolvedValue([shirt, jeans]);
      remove.mockResolvedValue();
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Bottoms'));
      await fireEvent.press(screen.getByText('Edit'));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete Blue jeans' }));
      await pressAlertButton('Delete');

      expect(await screen.findByText('White linen shirt')).toBeOnTheScreen();
      expect(screen.queryByText('Bottoms')).not.toBeOnTheScreen();
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

  describe('deleting an item', () => {
    test('Edit shows a delete button on each card, Done hides it', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      expect(screen.getByRole('button', { name: 'Delete White linen shirt' })).toBeOnTheScreen();

      await fireEvent.press(screen.getByText('Done'));
      expect(
        screen.queryByRole('button', { name: 'Delete White linen shirt' }),
      ).not.toBeOnTheScreen();
    });

    test('a long press on a card starts editing', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      await fireEvent(await screen.findByText('White linen shirt'), 'longPress');
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
      await waitFor(() => expect(screen.queryByText('White linen shirt')).not.toBeOnTheScreen());
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
      expect(screen.getByText('White linen shirt')).toBeOnTheScreen();
    });

    test('keeps the item and says so when the delete fails', async () => {
      list.mockResolvedValue([shirt]);
      remove.mockRejectedValue(new Error('offline'));
      await render(<Closet />);

      await fireEvent.press(await screen.findByText('Edit'));
      await fireEvent.press(screen.getByRole('button', { name: 'Delete White linen shirt' }));
      await pressAlertButton('Delete');

      expect(alert).toHaveBeenLastCalledWith("Couldn't delete the item. Try again.");
      expect(screen.getByText('White linen shirt')).toBeOnTheScreen();
    });

    test('is available to screen readers as an action', async () => {
      list.mockResolvedValue([shirt]);
      await render(<Closet />);

      const card = await screen.findByText('White linen shirt');
      await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
      expect(alert).toHaveBeenCalledWith(
        'Delete “White linen shirt”?',
        expect.any(String),
        expect.any(Array),
      );
    });
  });
});
