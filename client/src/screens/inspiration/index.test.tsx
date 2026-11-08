import type { Inspiration as SavedLook } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { AccessibilityInfo, Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';
import { deleteInspiration, getStyle, listInspiration, refreshStyle, uploadPhoto } from '@/lib/api';
import { ApiError, OfflineError } from '@/lib/api-error';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { Inspiration } from '.';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush }),
    // Runs the callback once on mount, as if the tab just came into view.
    useFocusEffect: (callback: () => void) => useEffect(callback, [callback]),
  };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
  listInspiration: jest.fn(),
  deleteInspiration: jest.fn(),
  uploadPhoto: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  getStyle: jest.fn(),
  refreshStyle: jest.fn(),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const look = (n: number, createdAt = '2026-10-21T10:00:00.000Z'): SavedLook => ({
  key: `photos/u1/look-${n}.webp`,
  url: `/api/inspiration/photo?key=photos%2Fu1%2Flook-${n}.webp`,
  createdAt,
});

// A brief written on the 25th: looks saved before it are learned, the ones after are new.
const brief = {
  summary: 'High-low with a wink.',
  writtenAt: '2026-10-25T12:00:00.000Z',
  updating: false,
  suggest: null,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(listInspiration).mockResolvedValue([look(1), look(2)]);
  jest.mocked(getStyle).mockResolvedValue({ ...brief, summary: null, writtenAt: null });
  jest.mocked(shrinkPhoto).mockImplementation(async ({ uri }) => uri.replace('.png', '.jpg'));
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/new.webp');
  jest.mocked(deleteInspiration).mockResolvedValue();
});

describe('<Inspiration />', () => {
  test('opens Recreate the look from its row', async () => {
    await render(<Inspiration />);
    await fireEvent.press(screen.getByText('Recreate the look'));
    expect(mockPush).toHaveBeenCalledWith('/want-can');
  });

  test('without a brief, every look is new and nothing can be taught yet', async () => {
    await render(<Inspiration />);
    expect(await screen.findByRole('header', { name: 'New · 2' })).toBeOnTheScreen();
    expect(screen.getByText(/once your closet has 15 pieces/)).toBeOnTheScreen();
    expect(screen.queryByText('Taken to heart')).toBeNull();
    expect(screen.queryByText('Teach my stylist')).toBeNull();
  });

  test('ties the looks the brief has read to her style, and leaves the newer ones loose', async () => {
    jest.mocked(getStyle).mockResolvedValue(brief);
    jest
      .mocked(listInspiration)
      .mockResolvedValue([look(3, '2026-10-27T09:00:00.000Z'), look(1), look(2)]);
    await render(<Inspiration />);
    expect(await screen.findByText('High-low with a wink.')).toBeOnTheScreen();
    expect(await screen.findByRole('header', { name: 'New · 1' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Taken to heart' })).toBeOnTheScreen();
    expect(screen.getByText('2 saved looks')).toBeOnTheScreen();
  });

  test('shows the first 24 learned looks, and the rest on a tap', async () => {
    jest.mocked(getStyle).mockResolvedValue(brief);
    jest.mocked(listInspiration).mockResolvedValue(Array.from({ length: 26 }, (_, n) => look(n)));
    await render(<Inspiration />);
    await fireEvent.press(await screen.findByText('Show all 26'));
    expect(screen.getAllByLabelText(/^Saved look/)).toHaveLength(26);
  });

  test('teaches the stylist the new looks, and says when it already learned today', async () => {
    jest.mocked(getStyle).mockResolvedValue(brief);
    jest.mocked(listInspiration).mockResolvedValue([look(3, '2026-10-27T09:00:00.000Z'), look(1)]);
    jest.mocked(refreshStyle).mockRejectedValueOnce(new ApiError(409, 'style:wait'));
    await render(<Inspiration />);
    await fireEvent.press(await screen.findByText('Teach my stylist'));
    expect(refreshStyle).toHaveBeenCalledWith('en');
    expect(alert).toHaveBeenCalledWith(
      'Your stylist has already learned today. Try again tomorrow.',
    );

    jest.mocked(refreshStyle).mockResolvedValueOnce({ ...brief, updating: true });
    await fireEvent.press(screen.getByText('Teach my stylist'));
    expect(await screen.findByText('Learning…')).toBeOnTheScreen();
  });

  test("says when this month's update has gone, and reads the screen again", async () => {
    jest.mocked(getStyle).mockResolvedValue(brief);
    jest.mocked(listInspiration).mockResolvedValue([look(3, '2026-10-27T09:00:00.000Z'), look(1)]);
    jest.mocked(refreshStyle).mockRejectedValueOnce(new ApiError(409, 'style:month'));
    await render(<Inspiration />);
    const button = await screen.findByText('Teach my stylist');
    const readsBefore = jest.mocked(getStyle).mock.calls.length;
    await fireEvent.press(button);
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('Your stylist updates your style once a month.'),
    );
    expect(jest.mocked(getStyle).mock.calls.length).toBeGreaterThan(readsBefore);
  });

  test('saves several looks at once as inspiration', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///a.png', width: 100, height: 200 },
        { uri: 'file:///b.png', width: 100, height: 200 },
      ],
    } as never);
    await render(<Inspiration />);
    await waitFor(() => expect(listInspiration).toHaveBeenCalled());
    await fireEvent.press(screen.getByText('Add looks'));

    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(2));
    expect(uploadPhoto).toHaveBeenCalledWith('file:///a.jpg', 'en', 'inspiration');
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true }),
    );
  });

  test('says so when the day is used up', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///a.png', width: 100, height: 200 }],
    } as never);
    jest.mocked(uploadPhoto).mockRejectedValue(new ApiError(429, 'limit:inspiration'));
    await render(<Inspiration />);
    await fireEvent.press(screen.getByText('Add looks'));
    expect(
      await screen.findByText("That's enough looks for today. Save more tomorrow."),
    ).toBeOnTheScreen();
  });

  test('deletes a look after asking', async () => {
    await render(<Inspiration />);
    const [first] = await screen.findAllByRole('image');
    await fireEvent(first!, 'longPress');
    const buttons: AlertButton[] = alert.mock.lastCall?.[2] ?? [];
    await act(async () => {
      await buttons.find((b) => b.text === 'Delete')!.onPress?.();
    });
    expect(deleteInspiration).toHaveBeenCalledWith(look(1).key);
  });

  describe('waiting in place', () => {
    function pending<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => (resolve = done));
      return { promise, answer: (value: T) => act(async () => resolve(value)) };
    }

    test('shows the title and the bead, and nothing it can not know yet', async () => {
      jest.mocked(listInspiration).mockReturnValueOnce(pending<SavedLook[]>().promise);
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<Inspiration />);

      expect(screen.getByRole('header', { name: 'Inspiration' })).toBeOnTheScreen();
      expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();
      expect(screen.getByTestId('looks-waiting')).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith('Loading');
      expect(screen.queryByText('Try again')).not.toBeOnTheScreen();
    });

    test('the looks wait for her style, so they land on the right garland', async () => {
      const style = pending<Awaited<ReturnType<typeof getStyle>>>();
      jest.mocked(getStyle).mockReturnValueOnce(style.promise);
      await render(<Inspiration />);
      const title = screen.getByRole('header', { name: 'Inspiration' });

      // The looks are in, but which garland they hang on isn't known yet.
      expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();
      expect(screen.queryByRole('header', { name: /^New/ })).not.toBeOnTheScreen();
      expect(screen.queryByText(/Your stylist writes your style/)).not.toBeOnTheScreen();

      await style.answer({ ...brief, summary: null, writtenAt: null });

      expect(screen.getByRole('header', { name: 'New · 2' })).toBeOnTheScreen();
      expect(screen.getByText(/Your stylist writes your style/)).toBeOnTheScreen();
      expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
      // The very same element: the screen wasn't laid out anew.
      expect(screen.getByRole('header', { name: 'Inspiration' })).toBe(title);
    });

    test('looks that could not be read are not "no looks", and it tries again', async () => {
      jest.mocked(listInspiration).mockRejectedValueOnce(new Error('boom'));
      await render(<Inspiration />);

      expect(await screen.findByText("Couldn't load your looks.")).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Add looks' })).not.toBeOnTheScreen();

      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('header', { name: 'New · 2' })).toBeOnTheScreen();
      expect(screen.queryByText("Couldn't load your looks.")).not.toBeOnTheScreen();
    });

    test('a style that could not be read still leaves her looks and "Add looks"', async () => {
      jest.mocked(getStyle).mockRejectedValueOnce(new Error('boom'));
      await render(<Inspiration />);

      expect(await screen.findByRole('header', { name: 'New · 2' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Add looks' })).toBeOnTheScreen();
      expect(screen.queryByText("Couldn't load your looks.")).not.toBeOnTheScreen();
      expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
    });

    test('offline says so', async () => {
      jest.mocked(listInspiration).mockRejectedValueOnce(new OfflineError('unreachable'));
      await render(<Inspiration />);
      expect(await screen.findByText(/No connection to the server/)).toBeOnTheScreen();
    });
  });
});
