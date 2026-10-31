import type { Item, LookItem } from '@closet-ai/shared';

import { type Found, frameOf, slotsOf } from './curtain';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api${path}` }));

const found = (box: LookItem['box'], mine = false): Found => ({
  item: { box } as LookItem,
  match: mine
    ? { how: 'same', item: { id: 'i' } as Item, shop: [] }
    : { how: 'none', item: null, shop: [] },
});

describe('slotsOf', () => {
  // A square photo on a square stage, 1 point per 1/400 of the photo.
  const frame = { scale: 400, height: 400, left: 0, top: 0 };

  test('hangs every piece she has, and empty hangers only where there is room', () => {
    const slots = slotsOf(
      [
        found({ xMin: 0.2, yMin: 0.1, xMax: 0.8, yMax: 0.5 }, true), // her shirt
        found({ xMin: 0.2, yMin: 0.5, xMax: 0.8, yMax: 0.9 }), // trousers she lacks
        found({ xMin: 0.45, yMin: 0.05, xMax: 0.55, yMax: 0.08 }), // sunglasses: no room
        found({ xMin: 0.3, yMin: 0.2, xMax: 0.7, yMax: 0.45 }), // a vest under the shirt
      ],
      frame,
      1,
    );
    expect(slots.map((slot) => slot.index)).toEqual([1, 0]);
  });

  test('a piece she has always hangs, however small', () => {
    const slots = slotsOf(
      [found({ xMin: 0.45, yMin: 0.05, xMax: 0.55, yMax: 0.08 }, true)],
      frame,
      1,
    );
    expect(slots.map((slot) => slot.index)).toEqual([0]);
  });

  test('a missing piece just the hanger wide and 72 high gets one; narrower gets none', () => {
    // 84 × 72 points and 80 × 72 points on the 400-point stage.
    const slots = slotsOf(
      [
        found({ xMin: 0, yMin: 0, xMax: 84 / 400, yMax: 72 / 400 }),
        found({ xMin: 0.5, yMin: 0.5, xMax: 0.5 + 80 / 400, yMax: 0.5 + 72 / 400 }),
      ],
      frame,
      1,
    );
    expect(slots.map((slot) => slot.index)).toEqual([0]);
  });

  test('two missing pieces that overlap by less than half both get a hanger', () => {
    const slots = slotsOf(
      [
        found({ xMin: 0.1, yMin: 0.1, xMax: 0.5, yMax: 0.5 }),
        found({ xMin: 0.4, yMin: 0.1, xMax: 0.8, yMax: 0.5 }), // a quarter under the first
      ],
      frame,
      1,
    );
    expect(slots.map((slot) => slot.index).sort()).toEqual([0, 1]);
  });

  test('the larger of two overlapping missing pieces gets the hanger', () => {
    const slots = slotsOf(
      [
        found({ xMin: 0.4, yMin: 0.3, xMax: 0.6, yMax: 0.5 }), // a bag
        found({ xMin: 0.2, yMin: 0.2, xMax: 0.8, yMax: 0.6 }), // the shirt it's on
      ],
      frame,
      1,
    );
    expect(slots.map((slot) => slot.index)).toEqual([1]);
  });
});

describe('frameOf', () => {
  test('frames the pieces found, not the whole screenshot', () => {
    // A story screenshot (9 × 19.5) with the look in its middle third.
    const frame = frameOf(
      [
        found({ xMin: 0.3, yMin: 0.3, xMax: 0.7, yMax: 0.5 }),
        found({ xMin: 0.35, yMin: 0.55, xMax: 0.65, yMax: 0.6 }),
      ],
      9 / 19.5,
      390,
    );
    expect(frame.height).toBeLessThanOrEqual(520);
    // The look's top, less its margin, sits at the stage's top.
    expect(frame.top).toBeCloseTo(-0.25 * frame.scale);
  });

  test('a tall look is fitted to the height and centred across', () => {
    const frame = frameOf([found({ xMin: 0.45, yMin: 0, xMax: 0.55, yMax: 1 })], 1, 390);
    expect(frame.height).toBe(520);
    expect(frame.left + 0.5 * frame.scale).toBeCloseTo(195);
  });
});
