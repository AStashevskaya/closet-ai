import { render } from '@testing-library/react-native';

import { HandDrawn, heartPoints, lineLength, loopPoints, smoothPath } from './hand-drawn';

describe('hand-drawn shapes', () => {
  test('the same seed draws the same heart, another seed a slightly different one', () => {
    expect(smoothPath(heartPoints(200, 180, 7))).toBe(smoothPath(heartPoints(200, 180, 7)));
    expect(smoothPath(heartPoints(200, 180, 7))).not.toBe(smoothPath(heartPoints(200, 180, 8)));
  });

  test('a heart stays roughly in its box, with the tip at the bottom middle', () => {
    const points = heartPoints(200, 180, 3);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(-12);
      expect(x).toBeLessThan(212);
      expect(y).toBeGreaterThan(-12);
      expect(y).toBeLessThan(192);
    }
    const tip = points.reduce((low, p) => (p[1] > low[1] ? p : low));
    expect(tip[0]).toBeCloseTo(100, -1);
  });

  test('a loop runs past its start, so the ends cross', () => {
    const points = loopPoints(120, 120, 2);
    const [first, last] = [points[0]!, points[points.length - 1]!];
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeGreaterThan(5);
  });

  test("the dash is at least the line's length, so drawing it in shows the whole line", () => {
    const points = loopPoints(100, 100, 1);
    // A circle-ish loop of 100 runs about π·94 plus the overlap.
    expect(lineLength(points)).toBeGreaterThan(Math.PI * 94);
  });

  test('is hidden from screen readers', async () => {
    const view = await render(<HandDrawn shape="heart" drawn seed={1} />);
    expect(view.toJSON()).toMatchObject({ props: { accessibilityElementsHidden: true } });
  });
});
