import type { Item } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';
import { deleteItem, listItems } from '@/lib/api';
import { OfflineError } from '@/lib/api-error';

import { ClosetCategory } from './category';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack, canGoBack: () => true }),
    // Runs the callback once on mount, as if the screen just came into view.
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
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

async function pressAlertButton(text: string) {
  const buttons: AlertButton[] = alert.mock.lastCall?.[2] ?? [];
  const button = buttons.find((b) => b.text === text);
  if (!button) throw new Error(`No "${text}" button in the dialog`);
  await act(async () => {
    button.onPress?.();
  });
}

const skirt: Item = {
  id: '6b1f7c3e-0000-4000-8000-000000000101',
  name: 'Satin skirt',
  category: 'bottom',
  colors: ['pink'],
  seasons: [],
  photoUrl: '/api/items/6b1f7c3e-0000-4000-8000-000000000101/photo',
  createdAt: '2026-10-18T10:00:00.000Z',
};
const jeans: Item = { ...skirt, id: '6b1f7c3e-0000-4000-8000-000000000102', name: 'Blue jeans' };
const shirt: Item = {
  ...skirt,
  id: '6b1f7c3e-0000-4000-8000-000000000103',
  name: 'White linen shirt',
  category: 'top',
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<ClosetCategory />', () => {
  describe('waiting in place', () => {
    function pendingLoad() {
      let resolve: (items: Item[]) => void = () => {};
      list.mockReturnValue(
        new Promise<Item[]>((res) => {
          resolve = res;
        }),
      );
      return (items: Item[]) => act(async () => resolve(items));
    }

    test('shows the category name and its rail with the bead, no count, no edit', async () => {
      pendingLoad();
      await render(<ClosetCategory category="bottom" />);

      expect(screen.getByRole('header', { name: 'Bottoms' })).toBeOnTheScreen();
      expect(screen.getAllByTestId('thread-waiting', { includeHiddenElements: true })).toHaveLength(
        1,
      );
      expect(screen.queryByText('Edit')).not.toBeOnTheScreen();
      expect(screen.queryByText('Nothing here yet.')).not.toBeOnTheScreen();
      expect(screen.queryByText('Try again')).not.toBeOnTheScreen();
    });

    test('the bead goes and the pieces settle in under the same title', async () => {
      const answer = pendingLoad();
      await render(<ClosetCategory category="bottom" />);
      const title = screen.getByRole('header', { name: 'Bottoms' });

      await answer([skirt]);

      expect(screen.getByText('Satin skirt')).toBeOnTheScreen();
      expect(screen.getByText('1 item')).toBeOnTheScreen();
      expect(screen.getByText('Edit')).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId('thread-waiting', { includeHiddenElements: true }),
      ).toHaveLength(0);
      expect(screen.getByRole('header', { name: 'Bottoms' })).toBe(title);
    });

    test('a category with nothing in it says so only after the load, and goes back', async () => {
      const answer = pendingLoad();
      await render(<ClosetCategory category="bottom" />);
      expect(mockBack).not.toHaveBeenCalled();

      await answer([shirt]);

      expect(screen.getByText('Nothing here yet.')).toBeOnTheScreen();
      expect(mockBack).toHaveBeenCalled();
    });

    test('a failed load keeps the title and offers to retry', async () => {
      list.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce([skirt]);
      await render(<ClosetCategory category="bottom" />);

      expect(await screen.findByText("Couldn't load your closet.")).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Bottoms' })).toBeOnTheScreen();
      expect(screen.queryByText('Nothing here yet.')).not.toBeOnTheScreen();
      expect(mockBack).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Satin skirt')).toBeOnTheScreen();
    });

    test('offline says so', async () => {
      list.mockRejectedValueOnce(new OfflineError());
      await render(<ClosetCategory category="bottom" />);

      expect(await screen.findByText(/No connection to the server/)).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    });
  });

  test('shows every piece of the category and nothing else', async () => {
    list.mockResolvedValue([skirt, shirt, jeans]);
    await render(<ClosetCategory category="bottom" />);

    expect(await screen.findByText('Satin skirt')).toBeOnTheScreen();
    expect(screen.getByText('Blue jeans')).toBeOnTheScreen();
    expect(screen.getByText('Bottoms')).toBeOnTheScreen();
    expect(screen.getByText('2 items')).toBeOnTheScreen();
    expect(screen.queryByText('White linen shirt')).not.toBeOnTheScreen();
  });

  test('opens the item screen from a card', async () => {
    list.mockResolvedValue([skirt]);
    await render(<ClosetCategory category="bottom" />);

    await fireEvent.press(await screen.findByText('Satin skirt'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/item/[id]', params: { id: skirt.id } });
  });

  test('deletes after asking, and goes back once the category is empty', async () => {
    list.mockResolvedValue([skirt]);
    remove.mockResolvedValue();
    await render(<ClosetCategory category="bottom" />);

    await fireEvent.press(await screen.findByText('Edit'));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete Satin skirt' }));
    await pressAlertButton('Delete');

    expect(remove).toHaveBeenCalledWith(skirt.id);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});
