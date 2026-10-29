import type { Item, StyledEntry, WearWithRequest } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { seedFrom } from '@/components/hand-drawn';
import i18n from '@/i18n';
import {
  askWearWith,
  getUsage,
  getWearWith,
  listItems,
  listStyled,
  reactToOutfit,
} from '@/lib/api';
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

  test("folds a look that isn't hers, asks why in a tap, and brings it back", async () => {
    jest.mocked(askWearWith).mockResolvedValue({ id: 'req-1' });
    await render(<StyleIt />);
    await pickSkirt();
    await fireEvent.press(await screen.findByRole('button', { name: 'Not me, look 1 of 1' }));
    const id = looks('req-1').outfits[0]!.id;
    expect(reactToOutfit).toHaveBeenLastCalledWith(id, 'dislike');
    expect(screen.queryByText('The tee makes the satin offhand.')).toBeNull();
    expect(screen.getByText('Why not? One tap teaches your stylist.')).toBeOnTheScreen();

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
});
