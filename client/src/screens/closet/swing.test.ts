import { leanFor } from './swing';

describe('leanFor', () => {
  test('hangs straight while the rail is still', () => {
    expect(leanFor(0, false)).toBeCloseTo(0);
  });

  test('leans against the way the rail moves, more the faster it goes', () => {
    // Moving towards the start (left in English), the pieces trail to the right: a negative turn.
    expect(leanFor(0.5, false)).toBeLessThan(0);
    expect(leanFor(1, false)).toBeLessThan(leanFor(0.5, false));
  });

  test('mirrors in right-to-left layouts', () => {
    expect(leanFor(0.5, true)).toBeCloseTo(-leanFor(0.5, false));
  });

  test('never leans past the limit, however hard the fling', () => {
    expect(leanFor(50, false)).toBe(-15);
    expect(leanFor(-50, false)).toBe(15);
  });
});
