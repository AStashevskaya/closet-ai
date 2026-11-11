import type { Item, StyledEntry, WearWithRequest } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Alert, ScrollView } from 'react-native';

import { seedFrom } from '@/components/hand-drawn';
import i18n from '@/i18n';
import {
  askWearWith,
  deleteWearWith,
  getUsage,
  getWearWith,
  listItems,
  listStyled,
  reactToOutfit,
} from '@/lib/api';
import { ApiError, OfflineError } from '@/lib/api-error';

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
  deleteWearWith: jest.fn(),
  getWearWith: jest.fn(),
  reactToOutfit: jest.fn(),
  getUsage: jest.fn(),
  sessionHeaders: jest.fn().mockResolvedValue({ cookie: 'session=1' }),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

// The heart stands in as a marker, named by its seed, so a test can tell which one is drawn.
jest.mock('@/components/hand-drawn', () => {
  const { View } = jest.requireActual('react-native');
  const actual = jest.requireActual('@/components/hand-drawn');
  return {
    ...actual,
    HandDrawn: ({ drawn, seed }: { drawn: boolean; seed: number }) =>
      drawn ? <View testID={`drawn-${seed}`} /> : null,
  };
});

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
  loose: false,
  wishAskAt: null,
  previews: [
    {
      id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a91',
      liked: true,
      pieces: [{ id: skirt.id, photoUrl: skirt.photoUrl!, cutoutUrl: null }],
    },
  ],
};

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
      pieces: [{ hero: true, item: skirt, catalogItem: null }],
      opinion: null,
      reason: null,
      woreCount: 0,
    },
  ],
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(listItems).mockResolvedValue([skirt]);
  jest.mocked(listStyled).mockResolvedValue([styled]);
  jest.mocked(getUsage).mockRejectedValue(new Error('offline'));
  jest.mocked(getWearWith).mockImplementation(async (id) => looks(id));
  jest.mocked(reactToOutfit).mockResolvedValue();
});

// The nth read of request `id` finds it failed; every other read, its looks.
function failOnRead(id: string, nth: number) {
  let reads = 0;
  jest.mocked(getWearWith).mockImplementation(async (asked) => {
    if (asked === id && ++reads === nth) return { ...looks(id), status: 'failed', outfits: [] };
    return looks(asked);
  });
}

// "From my closet" opens the sheet with the whole closet; the skirt is picked from it.
async function pickSkirt() {
  await fireEvent.press(await screen.findByRole('button', { name: 'From my closet' }));
  await fireEvent.press(screen.getByLabelText('What do I wear this with? Satin midi skirt'));
}

describe('<StyleIt />', () => {
  test('keeps a diary: every piece styled is a stop, its looks folded small', async () => {
    await render(<StyleIt />);
    expect(await screen.findByLabelText('Outfits with Leather jacket')).toBeOnTheScreen();
    expect(screen.getByText(/October 21/)).toBeOnTheScreen();
    // The folded looks come with the list: no request per stop.
    expect(await screen.findAllByTestId('mini-look', { includeHiddenElements: true })).toHaveLength(
      1,
    );
    expect(getWearWith).not.toHaveBeenCalled();
  });

  // Presses "Delete" in the confirmation, which says plainly what deleting does.
  async function confirmDelete() {
    const [title, message, buttons] = alert.mock.calls.at(-1)!;
    expect(title).toBe('Delete this styling?');
    expect(message).toContain("can't be undone");
    expect(message).toContain("the try doesn't come back");
    expect(deleteWearWith).not.toHaveBeenCalled();
    await act(async () => {
      buttons!.find((button) => button.style === 'destructive')!.onPress!();
    });
  }

  test('deletes a stop with a visible button, after asking, without opening it', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await render(<StyleIt />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Delete the styling of Leather jacket' }),
    );
    expect(screen.queryByTestId('open-stop')).toBeNull();
    await confirmDelete();
    expect(deleteWearWith).toHaveBeenCalledWith(styled.id);
    await waitFor(() => expect(screen.queryByLabelText('Outfits with Leather jacket')).toBeNull());
    expect(announce).toHaveBeenCalledWith('Styling deleted');
  });

  test('offers delete to screen readers as an action of the stop', async () => {
    await render(<StyleIt />);
    const stop = await screen.findByLabelText('Outfits with Leather jacket');
    expect(stop.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete styling' }]);
    await act(async () => {
      stop.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    });
    expect(alert).toHaveBeenCalledWith(
      'Delete this styling?',
      expect.any(String),
      expect.any(Array),
    );
  });

  test('a failed delete says so and keeps the stop, so it can be tried again', async () => {
    jest.mocked(deleteWearWith).mockRejectedValueOnce(new ApiError(500, 'boom'));
    await render(<StyleIt />);
    const name = 'Delete the styling of Leather jacket';
    await fireEvent.press(await screen.findByRole('button', { name }));
    await confirmDelete();
    expect(alert).toHaveBeenLastCalledWith("Couldn't delete the styling. Try again.");
    expect(screen.getByLabelText('Outfits with Leather jacket')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  test('a styling the server no longer has counts as deleted', async () => {
    jest.mocked(deleteWearWith).mockRejectedValueOnce(new ApiError(404, 'request not found'));
    await render(<StyleIt />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Delete the styling of Leather jacket' }),
    );
    await confirmDelete();
    await waitFor(() => expect(screen.queryByLabelText('Outfits with Leather jacket')).toBeNull());
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test('the open stop offers no delete while its looks are composed', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    jest
      .mocked(getWearWith)
      .mockResolvedValue({ ...looks('req-1'), status: 'pending', outfits: [] });
    await render(<StyleIt />);
    await pickSkirt();
    expect(await screen.findByTestId('open-stop')).toBeOnTheScreen();
    await waitFor(() => expect(getWearWith).toHaveBeenCalled());
    // Lets the server's "pending" answer reach the screen before looking.
    await act(async () => {});
    expect(
      screen.queryByRole('button', { name: 'Delete the styling of Satin midi skirt' }),
    ).toBeNull();
  });

  test('the open stop offers the delete once its looks came', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    jest.mocked(getWearWith).mockResolvedValue(looks('req-1'));
    await render(<StyleIt />);
    await pickSkirt();
    expect(
      await screen.findByRole('button', { name: 'Delete the styling of Satin midi skirt' }),
    ).toBeOnTheScreen();
  });

  test("a list read just before a delete doesn't bring the stop back", async () => {
    let answer!: (list: StyledEntry[]) => void;
    await render(<StyleIt />);
    const name = 'Delete the styling of Leather jacket';
    await screen.findByRole('button', { name });
    jest
      .mocked(listStyled)
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    jest.mocked(getWearWith).mockResolvedValue(looks('req-1'));
    await pickSkirt();
    await fireEvent.press(await screen.findByRole('button', { name }));
    await confirmDelete();
    await act(async () => answer([styled]));
    expect(screen.queryByLabelText('Outfits with Leather jacket')).toBeNull();
  });

  test("says the closet couldn't be read, not that it's empty, and tries again", async () => {
    jest.mocked(listItems).mockRejectedValueOnce(new Error('offline'));
    await render(<StyleIt />);
    expect(await screen.findByText("Couldn't load your closet.")).toBeOnTheScreen();
    expect(screen.queryByText(/Add a few pieces/)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'From my closet' })).toBeOnTheScreen();
  });

  test('sends a reason only after its "Not mine" got through', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    let through!: () => void;
    jest
      .mocked(reactToOutfit)
      .mockImplementationOnce(() => new Promise<void>((resolve) => (through = resolve)));
    await render(<StyleIt />);
    await pickSkirt();
    await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));
    await fireEvent.press(
      screen.getByRole('radio', { name: 'Wrong for the weather, look 1 of 1' }),
    );
    // The reason is shown at once but waits for the dislike before it's sent.
    expect(screen.getByRole('radio', { name: 'Wrong for the weather, look 1 of 1' })).toBeChecked();
    expect(reactToOutfit).toHaveBeenCalledTimes(1);

    await act(async () => through());
    const id = looks('req-1').outfits[0]!.id;
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'dislike', 'weather');
  });

  test("keeps a look that isn't hers in place, asks why in a tap, and brings it back", async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<StyleIt />);
    await pickSkirt();
    await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));
    const id = looks('req-1').outfits[0]!.id;
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'dislike');
    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(screen.getByText('Why not? One tap teaches your stylist.')).toBeOnTheScreen();
    // Her answer is the reasons now: the reactions wait until she brings it back.
    expect(screen.queryByRole('button', { name: 'Not me, look 1 of 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Like, look 1 of 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wore it, look 1 of 1' })).toBeNull();

    await fireEvent.press(
      screen.getByRole('radio', { name: 'Wrong for the weather, look 1 of 1' }),
    );
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'dislike', 'weather');
    expect(screen.getByRole('radio', { name: 'Wrong for the weather, look 1 of 1' })).toBeChecked();
    // The same reason again sends nothing.
    await fireEvent.press(
      screen.getByRole('radio', { name: 'Wrong for the weather, look 1 of 1' }),
    );
    expect(reactToOutfit).toHaveBeenCalledTimes(2);

    await fireEvent.press(screen.getByRole('button', { name: 'Bring it back, look 1 of 1' }));
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'none');
    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Like, look 1 of 1' })).toBeOnTheScreen();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  test('a look liked and then rejected loses its heart', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<StyleIt />);
    await pickSkirt();
    const heart = `drawn-${seedFrom(looks('req-1').outfits[0]!.id)}`;
    // The look's own heart hangs on its wire, which is drawn once it has a width.
    await fireEvent(
      await screen.findByLabelText('Сатин после спорта, Satin midi skirt'),
      'layout',
      {
        nativeEvent: { layout: { width: 300 } },
      },
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Like, look 1 of 1' }));
    expect(screen.getByTestId(heart, { includeHiddenElements: true })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Not me, look 1 of 1' }));
    expect(screen.queryByTestId(heart, { includeHiddenElements: true })).toBeNull();
  });

  test('styles a closet piece in the mood picked, its outfits growing right here', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<StyleIt />);
    await fireEvent.press(await screen.findByRole('button', { name: 'From my closet' }));
    await fireEvent.press(screen.getByText('Evening'));
    await fireEvent.press(screen.getByLabelText('What do I wear this with? Satin midi skirt'));

    expect(askWearWith).toHaveBeenCalledWith({ itemId: skirt.id, mood: 'evening' }, 'en');
    expect(
      await screen.findByRole('header', { name: 'Outfits with Satin midi skirt' }),
    ).toBeOnTheScreen();
    expect(await screen.findByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(getWearWith).toHaveBeenCalledWith('req-1', 'en');
    expect(mockPush).not.toHaveBeenCalled();

    // Reactions work here as on the outfits screen.
    await fireEvent.press(screen.getByRole('button', { name: 'Like, look 1 of 1' }));
    expect(reactToOutfit).toHaveBeenLastCalledWith(looks('req-1').outfits[0]!.id, 'like');
    expect(screen.getByRole('button', { name: 'Like, look 1 of 1' })).toBeSelected();
  });

  test('says so when the outfits could not be put together, and asks again', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    failOnRead('req-1', 1);
    await render(<StyleIt />);
    await pickSkirt();
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(askWearWith).toHaveBeenCalledTimes(2));
  });

  test('brings the piece opened up to the top of the screen, once it is laid out', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
    // Restored even when an expectation fails, so it can't leak into the next tests.
    try {
      await render(<StyleIt />);
      await fireEvent(await screen.findByTestId('diary'), 'layout', {
        nativeEvent: { layout: { y: 300, height: 600 } },
      });
      await fireEvent.press(await screen.findByLabelText('Outfits with Leather jacket'));
      // Not before the opened piece has its place: the one open before may still be folding.
      expect(scrollTo).not.toHaveBeenCalled();
      await fireEvent(screen.getByTestId('open-stop'), 'layout', {
        nativeEvent: { layout: { y: 120, height: 400 } },
      });
      expect(scrollTo).toHaveBeenCalledWith({ y: 300 + 120 - 16, animated: true });
      // Its outfits arriving later don't move the screen again.
      await fireEvent(screen.getByTestId('open-stop'), 'layout', {
        nativeEvent: { layout: { y: 120, height: 900 } },
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      scrollTo.mockRestore();
    }
  });

  test('opens a piece from a photo, and outfits asked for before', async () => {
    await render(<StyleIt />);
    await fireEvent.press(await screen.findByRole('button', { name: '+ From a photo' }));
    expect(mockPush).toHaveBeenCalledWith('/wear-with-pick');

    await fireEvent.press(await screen.findByLabelText('Outfits with Leather jacket'));
    expect(
      await screen.findByRole('header', { name: 'Outfits with Leather jacket' }),
    ).toBeOnTheScreen();
    await waitFor(() => expect(getWearWith).toHaveBeenCalledWith(styled.id, 'en'));
  });

  test('a piece from a photo that is not hers opens its own screen, with its wish counted down', async () => {
    const photoPiece: StyledEntry = {
      ...styled,
      id: '6b1f7c3e-0000-4000-8000-0000000000bb',
      name: 'Wool coat',
      loose: true,
      // Two and a half days from now: a day begun counts, so "3 days to go".
      wishAskAt: new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000).toISOString(),
    };
    jest.mocked(listStyled).mockResolvedValue([photoPiece, styled]);
    await render(<StyleIt />);
    expect(await screen.findByText('In your wishes · 3 days to go')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Outfits with Wool coat'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/wear-with/[id]',
      params: { id: photoPiece.id },
    });
    expect(getWearWith).not.toHaveBeenCalledWith(photoPiece.id, 'en');
  });

  test('draws the heart around the piece only once one of its outfits is liked', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<StyleIt />);
    await pickSkirt();
    await screen.findByText('The tee makes the satin offhand.');
    expect(screen.queryByTestId(`drawn-${seedFrom('req-1')}`)).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Like, look 1 of 1' }));
    expect(screen.getByTestId(`drawn-${seedFrom('req-1')}`)).toBeOnTheScreen();
  });

  test('a reaction failing after switching pieces leaves the new piece alone', async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    let fail!: (cause: Error) => void;
    jest.mocked(reactToOutfit).mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await render(<StyleIt />);
    await pickSkirt();
    // Not awaited: the press waits on the reaction, which hangs until `fail`.
    void fireEvent.press(await screen.findByRole('button', { name: 'Like, look 1 of 1' }));
    await waitFor(() => expect(reactToOutfit).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Outfits with Leather jacket'));
    await screen.findByRole('header', { name: 'Outfits with Leather jacket' });
    await screen.findByText('The tee makes the satin offhand.');
    await act(async () => fail(new Error('offline')));

    expect(screen.getByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(screen.queryByText('Putting looks together from your closet…')).toBeNull();
  });

  test('polls an entry styled before again when it timed out', async () => {
    // Opened, its first read finds it timed out.
    failOnRead(styled.id, 1);
    await render(<StyleIt />);
    await fireEvent.press(await screen.findByLabelText('Outfits with Leather jacket'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('The tee makes the satin offhand.')).toBeOnTheScreen();
    expect(askWearWith).not.toHaveBeenCalled();
  });

  test('says there is no connection when asking for the outfits got no answer', async () => {
    jest.mocked(askWearWith).mockRejectedValue(new OfflineError('timed out'));
    await render(<StyleIt />);
    await pickSkirt();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(expect.stringMatching(/No connection to the server/)),
    );
  });

  test('says when the outfits are off', async () => {
    jest.mocked(askWearWith).mockRejectedValue(new ApiError(503, 'outfits are off'));
    await render(<StyleIt />);
    await pickSkirt();
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Looks aren't available right now."));
  });

  test('asks for a few pieces first when the closet is empty', async () => {
    jest.mocked(listItems).mockResolvedValue([]);
    await render(<StyleIt />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add an item' }));
    expect(mockPush).toHaveBeenCalledWith('/add-item');
  });

  describe('waiting in place', () => {
    function pending<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => (resolve = done));
      return { promise, answer: (value: T) => act(async () => resolve(value)) };
    }

    test('shows the title and the thread with the bead, and nothing it can not know yet', async () => {
      jest.mocked(listItems).mockReturnValueOnce(pending<Item[]>().promise);
      jest.mocked(listStyled).mockReturnValueOnce(pending<StyledEntry[]>().promise);
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<StyleIt />);

      expect(screen.getByRole('header', { name: 'Style it' })).toBeOnTheScreen();
      expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();
      expect(screen.getByTestId('thread-row-waiting')).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith('Loading');
      expect(screen.queryByRole('button', { name: 'From my closet' })).not.toBeOnTheScreen();
      expect(screen.queryByTestId('style-example')).not.toBeOnTheScreen();
      expect(screen.queryByText(/Add a few pieces/)).not.toBeOnTheScreen();
    });

    test('the closet and the diary land together, under the same title', async () => {
      const closet = pending<Item[]>();
      const diary = pending<StyledEntry[]>();
      jest.mocked(listItems).mockReturnValueOnce(closet.promise);
      jest.mocked(listStyled).mockReturnValueOnce(diary.promise);
      await render(<StyleIt />);
      const title = screen.getByRole('header', { name: 'Style it' });

      await closet.answer([skirt]);
      // One of the two in: still one bead, and nothing has moved.
      expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'From my closet' })).not.toBeOnTheScreen();

      await diary.answer([styled]);
      expect(screen.getByRole('button', { name: 'From my closet' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: `Outfits with ${styled.name}` })).toBeOnTheScreen();
      expect(screen.queryByTestId('thread-row-waiting')).not.toBeOnTheScreen();
      // The very same element: the screen wasn't laid out anew.
      expect(screen.getByRole('header', { name: 'Style it' })).toBe(title);
    });

    test('shows the example only once the diary has been read and is empty', async () => {
      jest.mocked(listStyled).mockResolvedValueOnce([]);
      await render(<StyleIt />);
      expect(await screen.findByTestId('style-example')).toBeOnTheScreen();
      expect(screen.getByText('example')).toBeOnTheScreen();
      // Three looks around the blazer, each named and hung from the app's own pictures.
      for (const name of ['easy', 'going out', 'bold']) {
        expect(screen.getByLabelText(new RegExp(`^${name}, Blazer, `))).toBeOnTheScreen();
      }
    });

    test('a diary that could not be read is not an empty one, and it tries again', async () => {
      jest.mocked(listStyled).mockRejectedValueOnce(new Error('boom'));
      await render(<StyleIt />);

      expect(await screen.findByText("Couldn't load the outfits you asked for.")).toBeOnTheScreen();
      expect(screen.queryByTestId('style-example')).not.toBeOnTheScreen();
      // The closet came, so the ways in are there.
      expect(screen.getByRole('button', { name: 'From my closet' })).toBeOnTheScreen();

      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('button', { name: `Outfits with ${styled.name}` }),
      ).toBeOnTheScreen();
      expect(screen.queryByText("Couldn't load the outfits you asked for.")).not.toBeOnTheScreen();
    });

    test('both failing say one thing, with one retry that reads both again', async () => {
      jest.mocked(listItems).mockRejectedValueOnce(new Error('boom'));
      jest.mocked(listStyled).mockRejectedValueOnce(new Error('boom'));
      await render(<StyleIt />);

      expect(await screen.findByText("Couldn't load your closet.")).toBeOnTheScreen();
      expect(screen.queryByText("Couldn't load the outfits you asked for.")).not.toBeOnTheScreen();
      expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);

      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: 'From my closet' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: `Outfits with ${styled.name}` })).toBeOnTheScreen();
    });

    test('offline says so', async () => {
      jest.mocked(listItems).mockRejectedValueOnce(new OfflineError('unreachable'));
      await render(<StyleIt />);
      expect(await screen.findByText(/No connection to the server/)).toBeOnTheScreen();
    });
  });
});
