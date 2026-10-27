import { render } from '@testing-library/react-native';

import { HandDrawn, heartPoints, lineLength, loopPoints, seedFrom, smoothPath } from './hand-drawn';

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

  test('the dash covers the whole curve: at least the polyline through its points', () => {
    const points = loopPoints(100, 100, 1);
    let polyline = 0;
    for (let i = 1; i < points.length; i++) {
      polyline += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
    }
    expect(lineLength(points)).toBeGreaterThanOrEqual(polyline);
    // …and not much more, or the drawing would stall at the end.
    expect(lineLength(points)).toBeLessThan(polyline * 1.05);
  });

  test('a seed from an id is stable and differs between ids', () => {
    expect(seedFrom('outfit-1')).toBe(seedFrom('outfit-1'));
    expect(seedFrom('outfit-1')).not.toBe(seedFrom('outfit-2'));
  });

  test('mounts nothing until it is first drawn, then stays to fade out', async () => {
    const view = await render(<HandDrawn shape="heart" drawn={false} seed={1} />);
    expect(view.toJSON()).toBeNull();
    await view.rerender(<HandDrawn shape="heart" drawn seed={1} />);
    expect(view.toJSON()).not.toBeNull();
    await view.rerender(<HandDrawn shape="heart" drawn={false} seed={1} />);
    expect(view.toJSON()).not.toBeNull();
  });

  test('is hidden from screen readers', async () => {
    const view = await render(<HandDrawn shape="heart" drawn seed={1} />);
    expect(view.toJSON()).toMatchObject({ props: { accessibilityElementsHidden: true } });
  });
});
