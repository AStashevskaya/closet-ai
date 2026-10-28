import type { Inspiration as SavedLook } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';
import { deleteInspiration, getStyle, listInspiration, refreshStyle, uploadPhoto } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
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
    expect(screen.getByText(/once your closet has 8 pieces/)).toBeOnTheScreen();
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
});
