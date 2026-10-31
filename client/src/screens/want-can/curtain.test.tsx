import type { LookItem } from '@closet-ai/shared';

import { type Found, frameOf } from './curtain';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api${path}` }));

const found = (box: LookItem['box']): Found => ({
  item: { box } as LookItem,
  match: { how: 'none', item: null, shop: [] },
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
