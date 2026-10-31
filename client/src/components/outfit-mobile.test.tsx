import { fireEvent, render, screen } from '@testing-library/react-native';

import { hang, OutfitMobile } from './outfit-mobile';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api.test${path}` }));

const piece = (id: string, category: 'top' | 'bottom' | 'shoes' | 'accessory' | 'outerwear') => ({
  id,
  category,
  photoUrl: `/api/items/${id}/photo`,
  cutoutUrl: `/api/items/${id}/photo?variant=cutout`,
});

describe('hang', () => {
  test('hangs a look as worn: across from the shoulders to the shoes, shoes lowest', () => {
    const hung = hang(
      [
        piece('boots', 'shoes'),
        piece('skirt', 'bottom'),
        piece('bag', 'accessory'),
        piece('top', 'top'),
      ],
      300,
    );
    expect(hung.map((h) => h.piece.id)).toEqual(['top', 'skirt', 'boots', 'bag']);
    const drop = Object.fromEntries(hung.map((h) => [h.piece.id, h.drop]));
    expect(drop.top!).toBeLessThan(drop.skirt!);
    expect(drop.skirt!).toBeLessThan(drop.boots!);
    // Evenly spaced along the wire, none wider than its share of it.
    expect(hung.map((h) => h.x)).toEqual([37.5, 112.5, 187.5, 262.5]);
    expect(hung[0]!.width).toBeLessThanOrEqual(75);
  });

  test('keeps a lone piece from growing past its size', () => {
    expect(hang([piece('dress', 'top')], 300)[0]!.width).toBe(116);
  });
});

test('names the look for screen readers and hangs each piece once it has a width', async () => {
  await render(
    <OutfitMobile
      pieces={[piece('top', 'top'), { ...piece('skirt', 'bottom'), loose: true }]}
      headers={{ cookie: 'session' }}
      caption="Сатин после спорта"
    />,
  );
  const look = screen.getByLabelText('Сатин после спорта');
  expect(screen.queryAllByTestId('hung-piece', { includeHiddenElements: true })).toHaveLength(0);
  await fireEvent(look, 'layout', { nativeEvent: { layout: { width: 300 } } });
  expect(screen.getAllByTestId('hung-piece', { includeHiddenElements: true })).toHaveLength(2);
});
