import { item } from '@closet-ai/shared';

// The palette grew (migration 0029); an app that doesn't know a colour yet must still read the
// piece, or the whole closet list would fail to parse.
test('a colour this build does not know reads as multicolor', () => {
  const piece = item.parse({
    id: '6f1c2a52-8a43-4f4e-9b1a-3c2d1e0f9a01',
    name: 'Teal scarf',
    category: 'accessory',
    colors: ['teal', 'black'],
    seasons: [],
    createdAt: '2026-11-12T10:00:00.000Z',
  });
  expect(piece.colors).toEqual(['multicolor', 'black']);
});
