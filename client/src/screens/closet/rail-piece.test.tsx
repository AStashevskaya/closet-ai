import type { Item } from '@closet-ai/shared';
import { render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import { makeMutable } from 'react-native-reanimated';

import { RailPiece } from './rail-piece';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api.test${path}` }));

const shirt: Item = {
  id: '6b1f7c3e-0000-4000-8000-000000000201',
  name: 'White linen shirt',
  category: 'top',
  colors: ['white'],
  seasons: [],
  photoUrl: '/api/items/6b1f7c3e-0000-4000-8000-000000000201/photo',
  createdAt: '2026-10-18T10:00:00.000Z',
};
const cutoutUrl = `${shirt.photoUrl}?variant=cutout`;

async function renderPiece(item: Item, leaving = false) {
  await render(
    <RailPiece
      item={item}
      headers={{ cookie: 'session=1' }}
      editing={false}
      leaving={leaving}
      lean={makeMutable(0)}
      onLongPress={() => {}}
      onDelete={() => {}}
    />,
  );
}

async function photoOf(item: Item) {
  await renderPiece(item);
  return screen.getByTestId('item-photo').props;
}

describe('<RailPiece />', () => {
  test('hangs the cut-out whole, from the top', async () => {
    const photo = await photoOf({ ...shirt, cutoutUrl });
    expect(photo.contentFit).toBe('contain');
    // expo-image hands the position to the native view as an offset.
    expect(photo.contentPosition).toEqual(expect.objectContaining({ top: 0 }));
  });

  test('shows the photo as a print until the cut-out arrives', async () => {
    const photo = await photoOf(shirt);
    expect(photo.contentFit).toBe('cover');
  });

  test('stands shoes on the floor instead of hanging them', async () => {
    const photo = await photoOf({ ...shirt, category: 'shoes', cutoutUrl });
    expect(photo.contentPosition).toEqual(expect.objectContaining({ bottom: 0 }));
  });

  describe('once deleted', () => {
    afterEach(() => jest.restoreAllMocks());

    test('drops off the rail, tipping over', async () => {
      await renderPiece({ ...shirt, cutoutUrl }, true);
      expect(screen.getByTestId('rail-piece')).toHaveStyle({
        opacity: 0,
        transform: [{ translateY: 160 }, { rotate: '18deg' }, { scale: 1 }],
      });
    });

    test('only fades with reduced motion', async () => {
      jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
      await renderPiece({ ...shirt, cutoutUrl }, true);
      expect(screen.getByTestId('rail-piece')).toHaveStyle({
        opacity: 0,
        transform: [{ translateY: 0 }, { rotate: '0deg' }, { scale: 1 }],
      });
    });
  });
});
