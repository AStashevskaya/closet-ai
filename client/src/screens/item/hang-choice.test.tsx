import type { ItemDetail } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { canChooseHang, HangChoiceSheet, shownAs } from './hang-choice';

jest.mock('@/lib/api', () => ({
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));

const cutoutUrl = '/api/items/a/photo?variant=cutout&v=1';
const item: ItemDetail = {
  id: '6b1f7c3e-0000-4000-8000-000000000001',
  name: 'Black top',
  category: 'top',
  colors: ['black'],
  seasons: [],
  photoUrl: '/api/items/a/photo?v=1',
  cutoutUrl,
  cutoutBox: { xMin: 0.1, yMin: 0.1, xMax: 0.9, yMax: 0.9 },
  storedCutoutUrl: cutoutUrl,
  showPhoto: false,
  photoStatus: 'ready',
  createdAt: '2026-11-13T10:00:00.000Z',
  tags: null,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('shownAs', () => {
  test('drops the cut-out for the photo and brings the stored one back', () => {
    const photo = shownAs(item, true);
    expect(photo).toMatchObject({ showPhoto: true, cutoutUrl: undefined, cutoutBox: undefined });
    expect(photo.storedCutoutUrl).toBe(cutoutUrl);
    expect(shownAs(photo, false)).toMatchObject({ showPhoto: false, cutoutUrl });
  });
});

describe('canChooseHang', () => {
  test('only with a stored cut-out and a photo', () => {
    expect(canChooseHang(item)).toBe(true);
    expect(canChooseHang({ ...item, storedCutoutUrl: undefined })).toBe(false);
    expect(canChooseHang({ ...item, photoUrl: undefined })).toBe(false);
  });
});

describe('<HangChoiceSheet />', () => {
  const sheet = (props: Partial<Parameters<typeof HangChoiceSheet>[0]> = {}) => (
    <HangChoiceSheet
      item={item}
      headers={{ cookie: 'session=1' }}
      visible
      saving={false}
      onChoose={jest.fn()}
      onClose={jest.fn()}
      {...props}
    />
  );

  test('marks the version in use and offers the other', async () => {
    const onChoose = jest.fn();
    await render(sheet({ onChoose }));
    expect(
      screen.getByRole('button', { name: 'without background', selected: true }),
    ).toBeOnTheScreen();
    // Tapping the one in use changes nothing.
    await fireEvent.press(screen.getByRole('button', { name: 'without background' }));
    expect(onChoose).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'as in the photo' }));
    expect(onChoose).toHaveBeenCalledWith(true);
  });

  test('waits while a choice is saved', async () => {
    const onChoose = jest.fn();
    await render(sheet({ onChoose, saving: true }));
    const other = screen.getByRole('button', { name: 'as in the photo' });
    expect(other).toBeDisabled();
    await fireEvent.press(other);
    expect(onChoose).not.toHaveBeenCalled();
  });

  test('shows the photo as a print, and closes on Done', async () => {
    const onClose = jest.fn();
    await render(sheet({ onClose, item: shownAs(item, true) }));
    expect(
      screen.getByRole('button', { name: 'as in the photo', selected: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('as in the photo ✓', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
