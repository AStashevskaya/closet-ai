import type { Inspiration as SavedLook } from '@closet-ai/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert, type AlertButton } from 'react-native';

import i18n from '@/i18n';
import { deleteInspiration, listInspiration, uploadPhoto } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { shrinkPhoto } from '@/lib/shrink-photo';

import { Inspiration } from '.';

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
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/shrink-photo', () => ({ shrinkPhoto: jest.fn() }));
jest.mock('@/lib/api', () => ({
  listInspiration: jest.fn(),
  deleteInspiration: jest.fn(),
  uploadPhoto: jest.fn(),
  sessionHeaders: jest.fn(async () => ({ cookie: 'session' })),
  absoluteUrl: (path: string) => `http://api${path}`,
}));

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const look = (n: number): SavedLook => ({
  key: `photos/u1/look-${n}.webp`,
  url: `/api/inspiration/photo?key=photos%2Fu1%2Flook-${n}.webp`,
  createdAt: '2026-10-21T10:00:00.000Z',
});

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  jest.mocked(listInspiration).mockResolvedValue([look(1), look(2)]);
  jest.mocked(shrinkPhoto).mockImplementation(async ({ uri }) => uri.replace('.png', '.jpg'));
  jest.mocked(uploadPhoto).mockResolvedValue('photos/u1/new.webp');
  jest.mocked(deleteInspiration).mockResolvedValue();
});

describe('<Inspiration />', () => {
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
