import type { CatalogItem, Item, WearWithRequest } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo, Alert } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { DIMMED_OPACITY } from '@/components/dimmable';
import i18n from '@/i18n';
import {
  addWish,
  createItem,
  deleteWearWith,
  getWearWith,
  listItems,
  reactToOutfit,
} from '@/lib/api';
import { ApiError, OfflineError } from '@/lib/api-error';
import { clearClosetPieces } from '@/lib/closet-pieces';
import { ThreadRow } from '@/screens/style-it/thread-row';
import { colors } from '@/theme';

import { WearWith } from '.';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));

jest.mock('@/lib/api', () => ({
  addWish: jest.fn(),
  deleteWearWith: jest.fn(),
  getWearWith: jest.fn(),
  reactToOutfit: jest.fn(),
  createItem: jest.fn(),
  listItems: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

// The real row, with its props on record.
jest.mock('@/screens/style-it/thread-row', () => {
  const actual = jest.requireActual('@/screens/style-it/thread-row');
  return { ...actual, ThreadRow: jest.fn(actual.ThreadRow) };
});

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
  wishId: null,
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
      reason: null,
      woreCount: 0,
    },
  ],
};

beforeEach(async () => {
  jest.clearAllMocks();
  clearClosetPieces();
  await i18n.changeLanguage('en');
  jest.mocked(reactToOutfit).mockResolvedValue();
  jest.mocked(listItems).mockResolvedValue([]);
});

describe('<WearWith /> waiting in place', () => {
  const composing: WearWithRequest = {
    id: 'req-1',
    status: 'pending',
    outfits: [],
    addable: {
      name: 'Mauve satin skirt',
      category: 'bottom',
      colors: ['pink'],
      seasons: [],
      photoKey: 'photos/skirt.webp',
    },
    verdict: null,
    wishId: null,
  };
  // The running bead, whichever way it's hidden from screen readers.
  const bead = () => screen.queryAllByTestId('thread-waiting', { includeHiddenElements: true });
  // Whether the piece's own thread was last drawn dashed.
  const rootDashed = () =>
    jest
      .mocked(ThreadRow)
      .mock.calls.filter(([props]) => props.kind === 'root')
      .at(-1)?.[0].dashed;

  test('the first load: the thread and the bead, no caption until it is being composed', async () => {
    jest.mocked(getWearWith).mockReturnValue(new Promise(() => {}));
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<WearWith id="req-1" />);

    expect(bead()).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Loading');
    expect(screen.queryByText('Looking through your closet…')).not.toBeOnTheScreen();
    expect(screen.queryByText("Couldn't put looks together. Try again.")).not.toBeOnTheScreen();
  });

  test('composing: the words move on, and stay on the last step', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(getWearWith).mockResolvedValue(composing);
      await render(<WearWith id="item-1" />);
      await act(() => jest.advanceTimersByTimeAsync(10));
      expect(screen.getByText('Looking through your closet…')).toBeOnTheScreen();
      await act(() => jest.advanceTimersByTimeAsync(5000));
      expect(screen.getByText('Trying pieces together…')).toBeOnTheScreen();
      await act(() => jest.advanceTimersByTimeAsync(60000));
      expect(screen.getByText('Putting looks together from your closet…')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });
  test('composing: the piece alone on the rail, her closet going past under it', async () => {
    jest.mocked(getWearWith).mockResolvedValue(composing);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText('Looking through your closet…')).toBeOnTheScreen();
    expect(screen.getByTestId('bare-piece', { includeHiddenElements: true }).props.source).toEqual([
      expect.objectContaining({ uri: 'http://api/api/wear-with/req-1/photo' }),
    ]);
    expect(announce).toHaveBeenCalledWith('Putting looks together from your closet…');
    // The tag on the belt's rail: still one sign of waiting.
    expect(bead()).toHaveLength(1);
    // As in the prototype the name comes with the looks, and so do the actions and the empty note.
    expect(screen.queryByText('Mauve satin skirt')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add to my closet' })).not.toBeOnTheScreen();
    expect(screen.queryByText(/nothing in your closet/i)).not.toBeOnTheScreen();
  });

  test('the bead goes and the looks settle in beside the same piece', async () => {
    jest.mocked(getWearWith).mockResolvedValueOnce(composing).mockResolvedValue(done);
    await render(<WearWith id="req-1" />);

    expect(
      await screen.findByLabelText(
        'Сатин после спорта, Mauve satin skirt, Grey tee',
        {},
        { timeout: 4000 },
      ),
    ).toBeOnTheScreen();
    expect(bead()).toHaveLength(0);
    expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
  });

  test('a piece not hers turns dashed only when the result comes', async () => {
    jest
      .mocked(getWearWith)
      .mockResolvedValueOnce(composing)
      .mockResolvedValue({ ...done, addable: composing.addable, outfits: [] });
    await render(<WearWith id="req-1" />);
    await screen.findByText('Looking through your closet…');
    expect(rootDashed()).toBe(false);

    await waitFor(() => expect(rootDashed()).toBe(true), { timeout: 4000 });
  });

  test('no looks is apart from a failure: it says so without offering to try again', async () => {
    jest.mocked(getWearWith).mockResolvedValue({ ...done, outfits: [] });
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText(i18n.t('wearWith.empty'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeOnTheScreen();
    expect(bead()).toHaveLength(0);
  });

  test('a failure offers to try again, and waits in place again', async () => {
    jest
      .mocked(getWearWith)
      .mockResolvedValueOnce({ ...done, status: 'failed', outfits: [] })
      .mockReturnValue(new Promise(() => {}));
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText("Couldn't put looks together. Try again.")).toBeOnTheScreen();
    expect(bead()).toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(bead()).toHaveLength(1);
    expect(screen.queryByText("Couldn't put looks together. Try again.")).not.toBeOnTheScreen();
  });

  test('offline for a while it stops waiting, says so and offers to try again', async () => {
    jest.mocked(getWearWith).mockRejectedValue(new OfflineError());
    await render(<WearWith id="req-1" />);
    expect(bead()).toHaveLength(1);

    expect(
      await screen.findByText(/No connection to the server/, {}, { timeout: 12000 }),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    expect(getWearWith).toHaveBeenCalledTimes(5);
  }, 14000);

  describe('her closet going past', () => {
    const belt = () => screen.queryByTestId('closet-belt', { includeHiddenElements: true });

    test('not on the first load, when nothing is known yet', async () => {
      jest.mocked(getWearWith).mockReturnValue(new Promise(() => {}));
      await render(<WearWith id="req-1" />);

      expect(belt()).not.toBeOnTheScreen();
      expect(listItems).not.toHaveBeenCalled();
    });

    test('while composing, under the piece, with the only tag on its rail', async () => {
      jest.mocked(getWearWith).mockResolvedValue(composing);
      jest.mocked(listItems).mockResolvedValue([tee, skirt]);
      await render(<WearWith id="req-1" />);

      await screen.findByText('Looking through your closet…');
      expect(belt()).toBeOnTheScreen();
      await waitFor(() =>
        expect(screen.getAllByTestId('belt-piece', { includeHiddenElements: true })).toHaveLength(
          2,
        ),
      );
      expect(bead()).toHaveLength(1);
      expect(
        within(belt()!).getByTestId('thread-waiting', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      // The belt adds nothing for a screen reader: the progressbar still speaks for the wait.
      expect(screen.queryByTestId('closet-belt')).not.toBeOnTheScreen();
      expect(screen.getByRole('progressbar', { name: /Putting looks together/ })).toBeOnTheScreen();
    });

    test('a closet that fails to load only leaves the rail, and says nothing', async () => {
      jest.mocked(getWearWith).mockResolvedValue(composing);
      jest.mocked(listItems).mockRejectedValue(new Error('boom'));
      await render(<WearWith id="req-1" />);

      await screen.findByText('Looking through your closet…');
      await waitFor(() => expect(listItems).toHaveBeenCalled());
      expect(belt()).toBeOnTheScreen();
      expect(screen.getByText('Looking through your closet…')).toBeOnTheScreen();
      expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    });

    test('goes when the looks come', async () => {
      jest.mocked(getWearWith).mockResolvedValueOnce(composing).mockResolvedValue(done);
      await render(<WearWith id="req-1" />);

      await screen.findByText('Looking through your closet…');
      expect(belt()).toBeOnTheScreen();
      expect(
        await screen.findByText('Сатин после спорта', {}, { timeout: 5000 }),
      ).toBeOnTheScreen();
      expect(belt()).not.toBeOnTheScreen();
    });
  });

  test('with Reduce Motion the sign stays still on the thread, so she still sees it waits', async () => {
    const reduced = jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    jest.mocked(getWearWith).mockResolvedValue(composing);
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText('Looking through your closet…')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: /Putting looks together/ })).toBeOnTheScreen();
    expect(bead()).toHaveLength(1);
    reduced.mockReturnValue(false);
  });
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
        wishId: null,
      })
      .mockResolvedValue(done);
    await render(<WearWith id="req-1" />);
    expect(screen.getByText('Looking through your closet…')).toBeOnTheScreen();

    expect(
      await screen.findByLabelText(
        'Сатин после спорта, Mauve satin skirt, Grey tee',
        {},
        {
          timeout: 4000,
        },
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(screen.getByText('Mauve satin skirt · Grey tee')).toBeOnTheScreen();
    expect(screen.getByText('Missing: chunky white sneakers')).toBeOnTheScreen();
    expect(getWearWith).toHaveBeenCalledWith('req-1', 'en');
  });

  describe('deleting the styling', () => {
    let alert: jest.SpyInstance;
    beforeEach(() => {
      alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });
    afterEach(() => {
      alert.mockRestore();
      jest.useRealTimers();
    });

    // Presses "Delete" in the confirmation of the styling's delete button.
    async function deleteStyling(name: string) {
      await fireEvent.press(await screen.findByRole('button', { name }));
      const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls.at(-1)!;
      expect(title).toBe('Delete this styling?');
      expect(message).toContain("can't be undone");
      await act(async () => buttons!.find((b) => b.style === 'destructive')!.onPress!());
    }

    test('deletes it from the outfits screen and goes back', async () => {
      jest.mocked(getWearWith).mockResolvedValue(done);
      await render(<WearWith id="req-1" />);
      await deleteStyling('Delete the styling of Mauve satin skirt');
      expect(deleteWearWith).toHaveBeenCalledWith('req-1');
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    test('stays on the screen and says so when the delete fails', async () => {
      jest.mocked(getWearWith).mockResolvedValue(done);
      jest.mocked(deleteWearWith).mockRejectedValueOnce(new ApiError(500, 'boom'));
      await render(<WearWith id="req-1" />);
      await deleteStyling('Delete the styling of Mauve satin skirt');
      expect(alert).toHaveBeenLastCalledWith("Couldn't delete the styling. Try again.");
      expect(mockBack).not.toHaveBeenCalled();
      expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    });

    test('offers no delete on the first load, before anything is known', async () => {
      jest.mocked(getWearWith).mockReturnValue(new Promise(() => {}));
      await render(<WearWith id="req-1" />);
      expect(
        screen.getByTestId('thread-waiting', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      expect(screen.queryByText('Delete styling')).not.toBeOnTheScreen();
    });

    test('offers no delete until the looks arrive', async () => {
      jest.useFakeTimers();
      jest.mocked(getWearWith).mockResolvedValue({ ...done, status: 'pending', outfits: [] });
      await render(<WearWith id="req-1" />);
      await act(() => jest.advanceTimersByTimeAsync(2000));
      expect(screen.queryByText('Delete styling')).not.toBeOnTheScreen();

      jest.mocked(getWearWith).mockResolvedValue(done);
      await act(() => jest.advanceTimersByTimeAsync(2000));
      expect(
        screen.getByRole('button', { name: 'Delete the styling of Mauve satin skirt' }),
      ).toBeOnTheScreen();
    });

    test('leaving while the looks are being composed stops the polling', async () => {
      jest.useFakeTimers();
      jest.mocked(getWearWith).mockResolvedValue({ ...done, status: 'pending', outfits: [] });
      const { unmount } = await render(<WearWith id="req-1" />);
      await unmount();
      const polls = jest.mocked(getWearWith).mock.calls.length;
      expect(polls).toBeGreaterThan(0);
      await act(() => jest.advanceTimersByTimeAsync(10_000));
      expect(getWearWith).toHaveBeenCalledTimes(polls);
    });

    test('can delete a styling whose looks failed', async () => {
      jest.mocked(getWearWith).mockResolvedValue({ ...done, status: 'failed', outfits: [] });
      await render(<WearWith id="req-1" />);
      expect(await screen.findByText("Couldn't put looks together. Try again.")).toBeOnTheScreen();
      await deleteStyling('Delete styling');
      expect(deleteWearWith).toHaveBeenCalledWith('req-1');
      expect(mockBack).toHaveBeenCalledTimes(1);
    });
  });

  test('labels every partner piece and opens its card', async () => {
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
    const bag: CatalogItem = {
      ...boots,
      id: '0b2e7c1d-4a5f-4c3b-8d2e-1f0a9b8c7d6e',
      name: 'Shoulder bag',
      category: 'accessory',
      price: 389,
    };
    const look = done.outfits[0]!;
    jest.mocked(getWearWith).mockResolvedValue({
      ...done,
      outfits: [
        {
          ...look,
          missing: null,
          pieces: [
            ...look.pieces,
            { hero: false, item: null, catalogItem: boots },
            { hero: false, item: null, catalogItem: bag },
          ],
        },
      ],
    });
    await render(<WearWith id="req-1" />);

    const partner = await screen.findByRole('button', {
      name: 'Partner · demo brand: STUDIO EDIT, Ankle boots, ₪459',
    });
    // The closet's pieces stay apart from the partner's.
    expect(screen.getByText('Mauve satin skirt · Grey tee')).toBeOnTheScreen();
    // Shoes and a bag the closet had none of: both shown.
    expect(
      screen.getByRole('button', { name: 'Partner · demo brand: STUDIO EDIT, Shoulder bag, ₪389' }),
    ).toBeOnTheScreen();
    await fireEvent.press(partner);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/catalog/[id]', params: { id: boots.id } });
  });

  test('likes, takes the like back and counts every wear', async () => {
    jest.mocked(getWearWith).mockResolvedValue(done);
    await render(<WearWith id="req-1" />);
    const id = done.outfits[0]!.id;

    await fireEvent.press(await screen.findByRole('button', { name: 'Like, look 1 of 1' }));
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'like');
    expect(screen.getByRole('button', { name: 'Like, look 1 of 1' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Like, look 1 of 1' }));
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'none');

    await fireEvent.press(screen.getByRole('button', { name: 'Wore it, look 1 of 1' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Wore it · 1, look 1 of 1' }));
    expect(screen.getByRole('button', { name: 'Wore it · 2, look 1 of 1' })).toBeOnTheScreen();
  });

  describe('"Not mine"', () => {
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
    const hidden = { includeHiddenElements: true };

    test('keeps the whole look on the screen, dimmed, its words still readable', async () => {
      jest.mocked(getWearWith).mockResolvedValue({
        ...done,
        outfits: [
          { ...look, pieces: [...look.pieces, { hero: false, item: null, catalogItem: boots }] },
        ],
      });
      await render(<WearWith id="req-1" />);
      await fireEvent(
        await screen.findByLabelText(
          'Сатин после спорта, Mauve satin skirt, Grey tee, Ankle boots',
        ),
        'layout',
        { nativeEvent: { layout: { width: 300 } } },
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Not me, look 1 of 1' }));

      expect(screen.getByText('01 / 01 · Not me')).toBeOnTheScreen();
      expect(screen.getByText('weekend in town')).toBeOnTheScreen();
      expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
      expect(screen.getByText('Mauve satin skirt · Grey tee')).toBeOnTheScreen();
      expect(screen.getByText('Missing: chunky white sneakers')).toBeOnTheScreen();
      expect(
        screen.getByRole('button', {
          name: 'Partner · demo brand: STUDIO EDIT, Ankle boots, ₪459',
        }),
      ).toBeOnTheScreen();
      expect(screen.getAllByTestId('hung-piece', hidden)).toHaveLength(3);

      // Pictures fade; words change colour instead and stay outside what's faded.
      const pictures = screen.getByTestId('look-pictures', hidden);
      expect(pictures).toHaveStyle({ opacity: DIMMED_OPACITY });
      expect(screen.getByTestId('partner-picture', hidden)).toHaveStyle({
        opacity: DIMMED_OPACITY,
      });
      expect(within(pictures).queryByText('Сатин после спорта', hidden)).toBeNull();
      expect(screen.getByText('Сатин после спорта', hidden)).toHaveStyle({
        color: colors.textSecondary,
      });
      expect(screen.getByText('The tee makes the satin offhand.')).toHaveStyle({
        color: colors.textSecondary,
      });

      await fireEvent.press(screen.getByRole('button', { name: 'Bring it back, look 1 of 1' }));
      expect(screen.getByTestId('look-pictures', hidden)).toHaveStyle({ opacity: 1 });
      expect(screen.getByText('The tee makes the satin offhand.')).toHaveStyle({
        color: colors.text,
      });
    });

    test('does not remount the mobile, either way', async () => {
      jest.mocked(getWearWith).mockResolvedValue(done);
      await render(<WearWith id="req-1" />);
      // The mobile keeps its measured width in its own state. A remount would lose it and take the
      // pieces away until the next layout, which this test never sends again.
      await fireEvent(
        await screen.findByLabelText('Сатин после спорта, Mauve satin skirt, Grey tee'),
        'layout',
        { nativeEvent: { layout: { width: 300 } } },
      );
      expect(screen.getAllByTestId('hung-piece', hidden)).toHaveLength(2);

      await fireEvent.press(screen.getByRole('button', { name: 'Not me, look 1 of 1' }));
      expect(screen.getAllByTestId('hung-piece', hidden)).toHaveLength(2);

      await fireEvent.press(screen.getByRole('button', { name: 'Bring it back, look 1 of 1' }));
      expect(screen.getAllByTestId('hung-piece', hidden)).toHaveLength(2);
    });

    test('a look already rejected opens with its pieces and its reason', async () => {
      jest.mocked(getWearWith).mockResolvedValue({
        ...done,
        outfits: [{ ...look, opinion: 'dislike', reason: 'weather' }],
      });
      await render(<WearWith id="req-1" />);

      expect(await screen.findByText('The tee makes the satin offhand.')).toBeOnTheScreen();
      expect(
        screen.getByRole('radio', { name: 'Wrong for the weather, look 1 of 1' }),
      ).toBeChecked();
      expect(screen.queryByText('Why not? One tap teaches your stylist.')).toBeNull();
    });

    describe('when the dislike fails', () => {
      const id = look.id;
      // Holds the next reaction open until the test says how it ended.
      function holdReaction() {
        let fail!: () => void;
        let pass!: () => void;
        jest.mocked(reactToOutfit).mockImplementationOnce(
          () =>
            new Promise<void>((resolve, reject) => {
              pass = resolve;
              fail = () => reject(new Error('dropped'));
            }),
        );
        return { fail: () => fail(), pass: () => pass() };
      }
      const reason = { name: 'Wrong for the weather, look 1 of 1' };

      test('its reason is never sent, and the look goes back to unrated', async () => {
        jest.mocked(getWearWith).mockResolvedValue(done);
        const dislike = holdReaction();
        await render(<WearWith id="req-1" />);
        await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));
        await fireEvent.press(screen.getByRole('radio', reason));
        await act(async () => dislike.fail());

        expect(reactToOutfit).toHaveBeenCalledTimes(1);
        expect(reactToOutfit).toHaveBeenCalledWith(id, 'dislike');
        expect(screen.getByRole('button', { name: 'Not me, look 1 of 1' })).toBeOnTheScreen();
        expect(screen.queryByRole('radio')).toBeNull();
      });

      test('a liked look goes back to liked, not to unrated', async () => {
        jest.mocked(getWearWith).mockResolvedValue({
          ...done,
          outfits: [{ ...look, opinion: 'like' }],
        });
        const dislike = holdReaction();
        await render(<WearWith id="req-1" />);
        await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));
        await fireEvent.press(screen.getByRole('radio', reason));
        await act(async () => dislike.fail());

        expect(reactToOutfit).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Like, look 1 of 1' })).toBeSelected();
      });

      test('what she did next still counts: the failure does not undo it', async () => {
        jest.mocked(getWearWith).mockResolvedValue(done);
        const dislike = holdReaction();
        await render(<WearWith id="req-1" />);
        await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Bring it back, look 1 of 1' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Like, look 1 of 1' }));
        await act(async () => dislike.fail());

        expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'like');
        expect(screen.getByRole('button', { name: 'Like, look 1 of 1' })).toBeSelected();
      });

      test('a second reason still goes out after a failed first one', async () => {
        jest.mocked(getWearWith).mockResolvedValue({
          ...done,
          outfits: [{ ...look, opinion: 'dislike', reason: null }],
        });
        jest.mocked(reactToOutfit).mockRejectedValueOnce(new Error('dropped'));
        await render(<WearWith id="req-1" />);
        await fireEvent.press(await screen.findByRole('radio', reason));
        await waitFor(() => expect(screen.getByRole('radio', reason)).not.toBeChecked());

        await fireEvent.press(screen.getByRole('radio', reason));
        await waitFor(() => expect(reactToOutfit).toHaveBeenCalledTimes(2));
        expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'dislike', 'weather');
        expect(screen.getByRole('radio', reason)).toBeChecked();
      });
    });

    test('tells a screen reader, since the pressed button leaves the screen', async () => {
      jest.mocked(getWearWith).mockResolvedValue(done);
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<WearWith id="req-1" />);
      await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));

      expect(announce).toHaveBeenLastCalledWith(
        'Not me, look 1 of 1. Why not? One tap teaches your stylist.',
      );
    });

    test('names the reasons as a group, also once the visible question has gone', async () => {
      jest.mocked(getWearWith).mockResolvedValue({
        ...done,
        outfits: [{ ...look, opinion: 'dislike', reason: 'weather' }],
      });
      await render(<WearWith id="req-1" />);

      // By label, not by role: the group isn't `accessible` itself, or its radios couldn't be reached.
      const group = await screen.findByLabelText('Why not? One tap teaches your stylist.');
      expect(group.props.accessibilityRole).toBe('radiogroup');
      expect(screen.queryByText('Why not? One tap teaches your stylist.')).toBeNull();
    });
  });

  test('says so when the outfits could not be put together', async () => {
    jest.mocked(getWearWith).mockResolvedValue({
      id: 'req-1',
      status: 'failed',
      outfits: [],
      addable: null,
      verdict: null,
      wishId: null,
    });
    await render(<WearWith id="req-1" />);
    expect(await screen.findByText("Couldn't put looks together. Try again.")).toBeOnTheScreen();
  });
  test('stops asking at once when the styling is gone', async () => {
    jest.mocked(getWearWith).mockRejectedValue(new ApiError(404, 'request not found'));
    await render(<WearWith id="req-1" />);
    expect(await screen.findByText("Couldn't put looks together. Try again.")).toBeOnTheScreen();
    expect(getWearWith).toHaveBeenCalledTimes(1);
  });

  test('keeps asking through a dropped request', async () => {
    jest.useFakeTimers();
    jest.mocked(getWearWith).mockRejectedValueOnce(new Error('dropped')).mockResolvedValue(done);
    await render(<WearWith id="req-1" />);
    await act(() => jest.advanceTimersByTimeAsync(2000));
    expect(getWearWith).toHaveBeenCalledTimes(2);
    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    jest.useRealTimers();
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

  test('shows the piece on top, and the one like it she has on a short rail with it', async () => {
    jest.mocked(getWearWith).mockResolvedValue({
      ...done,
      verdict: { call: 'skip', reason: 'Almost your grey tee again.', twin: tee },
    });
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText('Mauve satin skirt', { exact: true })).toBeOnTheScreen();
    // The piece and her twin, both bare cut-outs; the new one first (its photo, no cut-out yet).
    const pieces = screen.getAllByTestId('bare-piece', { includeHiddenElements: true });
    expect(pieces[0]!.props.source).toEqual([
      { uri: `http://api${skirt.photoUrl}`, headers: { cookie: 'session' } },
    ]);
    expect(screen.getByText('Grey tee')).toBeOnTheScreen();
  });

  test('shows the piece and the one like it even when no outfits came of it', async () => {
    const addable = {
      name: 'Red leather skirt',
      category: 'bottom' as const,
      colors: ['red' as const],
      seasons: ['autumn' as const],
      photoKey: 'photos/u1/crop.webp',
    };
    jest.mocked(getWearWith).mockResolvedValue({
      ...done,
      outfits: [],
      addable,
      verdict: { call: 'skip', reason: 'Almost your grey tee again.', twin: tee },
    });
    await render(<WearWith id="req-1" />);

    expect(await screen.findByText('Red leather skirt')).toBeOnTheScreen();
    const [piece] = screen.getAllByTestId('bare-piece', { includeHiddenElements: true });
    expect(piece!.props.source).toEqual([
      { uri: 'http://api/api/wear-with/req-1/photo', headers: { cookie: 'session' } },
    ]);
    await fireEvent.press(
      screen.getByRole('button', { name: 'You already have one like it: Grey tee' }),
    );
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/item/[id]', params: { id: tee.id } });
    expect(screen.getByText('Nothing in your closet goes with it yet.')).toBeOnTheScreen();
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

  test('saves a piece from a photo to the wishes', async () => {
    const addable = {
      name: 'Red leather skirt',
      category: 'bottom' as const,
      colors: ['red' as const],
      seasons: ['autumn' as const],
      photoKey: 'photos/u1/crop.webp',
    };
    jest.mocked(getWearWith).mockResolvedValue({ ...done, addable });
    jest.mocked(addWish).mockResolvedValue({ id: 'wish-1' } as never);
    await render(<WearWith id="req-1" />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to wishes' }));

    expect(addWish).toHaveBeenCalledWith('req-1');
    expect(await screen.findByRole('button', { name: 'In your wishes' })).toBeDisabled();
  });

  test('says why adding or saving a piece from a photo did not go through', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      jest.mocked(getWearWith).mockResolvedValue({
        ...done,
        addable: {
          name: 'Red leather skirt',
          category: 'bottom',
          colors: ['red'],
          seasons: ['autumn'],
          photoKey: 'photos/u1/crop.webp',
        },
      });
      jest.mocked(createItem).mockRejectedValue(new Error('500'));
      jest.mocked(addWish).mockRejectedValue(new OfflineError());
      await render(<WearWith id="req-1" />);

      await fireEvent.press(await screen.findByRole('button', { name: 'Add to my closet' }));
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith("Couldn't add it to your closet. Try again."),
      );
      expect(screen.getByRole('button', { name: 'Add to my closet' })).toBeEnabled();

      // A free limit reached says which, not that it failed.
      jest.mocked(createItem).mockRejectedValue(new ApiError(429, 'limit:budget'));
      await fireEvent.press(screen.getByRole('button', { name: 'Add to my closet' }));
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith('The AI is resting for today. Try again tomorrow.'),
      );

      await fireEvent.press(screen.getByRole('button', { name: 'Add to wishes' }));
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith(
          'No connection to the server. Check the internet and try again.',
        ),
      );
    } finally {
      alert.mockRestore();
    }
  });
});
