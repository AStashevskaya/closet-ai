import { layOut } from './flat-lay';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api.test${path}` }));

const piece = (id: string, category: 'top' | 'bottom' | 'shoes' | 'accessory' | 'outerwear') => ({
  id,
  name: id,
  category,
});

describe('layOut', () => {
  test('gives a second accessory and a second layer places of their own', () => {
    const spots = layOut([
      piece('bag', 'accessory'),
      piece('hat', 'accessory'),
      piece('her jacket', 'outerwear'),
      piece('partner jacket', 'outerwear'),
    ]).map(([, spot]) => spot);
    expect(new Set(spots).size).toBe(4);
  });
});
