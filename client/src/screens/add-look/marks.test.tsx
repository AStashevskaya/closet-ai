import type { ItemBox, LookItem } from '@closet-ai/shared';

import { marksOf, placeLabels, rectOf, stageOf } from './marks';

const item = (box: ItemBox): LookItem => ({
  name: 'Piece',
  category: 'top',
  colors: [],
  seasons: [],
  fit: null,
  length: null,
  fabric: null,
  style: null,
  brand: null,
  condition: null,
  box,
  noun: null,
});

const label = { width: 90, height: 28 };

describe('stageOf', () => {
  test('a selfie fills the width, as tall as it is', () => {
    const stage = stageOf(9 / 16, 360);
    expect(stage).toMatchObject({ width: 360, height: 640, scale: 640, left: 0, top: 0 });
  });

  test('a very tall screenshot is shown whole, centred', () => {
    const stage = stageOf(0.25, 300);
    expect(stage.height).toBe(600);
    expect(stage.scale).toBe(600);
    expect(stage.left).toBeCloseTo((300 - 150) / 2);
  });
});

describe('marksOf', () => {
  const stage = stageOf(1, 400);

  test('loops a piece with room around it, kept on the stage', () => {
    const [mark] = marksOf([item({ xMin: 0, yMin: 0.25, xMax: 0.5, yMax: 0.75 })], 1, stage);
    expect(mark!.kind).toBe('loop');
    expect(mark!.at.left).toBe(2);
    expect(mark!.at.top).toBe(94);
    expect(mark!.at.height).toBe(212);
  });

  test('gives a small piece a bead instead', () => {
    const [mark] = marksOf([item({ xMin: 0.5, yMin: 0.1, xMax: 0.55, yMax: 0.15 })], 1, stage);
    expect(mark!.kind).toBe('bead');
    // Centred on the piece.
    expect(mark!.at.left + mark!.at.width / 2).toBeCloseTo(210);
  });

  test('draws the largest first, so a bag over a shirt is on top', () => {
    const shirt = item({ xMin: 0.2, yMin: 0.2, xMax: 0.8, yMax: 0.7 });
    const bag = item({ xMin: 0.5, yMin: 0.4, xMax: 0.7, yMax: 0.6 });
    expect(marksOf([bag, shirt], 1, stage).map((m) => m.index)).toEqual([1, 0]);
  });
});

describe('placeLabels', () => {
  const stage = stageOf(1, 400);

  test('puts a label above its piece, tied to its top', () => {
    const marks = marksOf([item({ xMin: 0.3, yMin: 0.4, xMax: 0.7, yMax: 0.8 })], 1, stage);
    const [placed] = placeLabels(marks, [label], stage);
    expect(placed!.top + label.height).toBeLessThanOrEqual(marks[0]!.at.top);
    expect(placed!.anchor).toEqual({ x: 200, y: marks[0]!.at.top });
  });

  test('moves beside the piece when there is no room above', () => {
    const marks = marksOf([item({ xMin: 0.2, yMin: 0, xMax: 0.5, yMax: 0.4 })], 1, stage);
    const [placed] = placeLabels(marks, [label], stage);
    expect(placed!.left).toBeGreaterThan(marks[0]!.at.left + marks[0]!.at.width);
  });

  test('never puts a label over another one, and keeps them on the stage', () => {
    const items = [
      item({ xMin: 0.3, yMin: 0.3, xMax: 0.7, yMax: 0.9 }),
      item({ xMin: 0.35, yMin: 0.32, xMax: 0.65, yMax: 0.5 }),
      item({ xMin: 0.4, yMin: 0.6, xMax: 0.6, yMax: 0.9 }),
    ];
    const marks = marksOf(items, 1, stage);
    const placed = placeLabels(
      marks,
      items.map(() => label),
      stage,
    );
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const p = placed[a]!;
        const q = placed[b]!;
        const apart =
          p.left + label.width <= q.left ||
          q.left + label.width <= p.left ||
          p.top + label.height <= q.top ||
          q.top + label.height <= p.top;
        expect(apart).toBe(true);
      }
    }
    for (const p of placed) {
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left + label.width).toBeLessThanOrEqual(400);
    }
  });

  test('labels come back by piece, whatever order they were placed in', () => {
    const items = [
      item({ xMin: 0.1, yMin: 0.5, xMax: 0.2, yMax: 0.6 }),
      item({ xMin: 0.3, yMin: 0.3, xMax: 0.9, yMax: 0.9 }),
    ];
    const marks = marksOf(items, 1, stage);
    const placed = placeLabels(marks, [label, label], stage);
    expect(placed).toHaveLength(2);
    const small = rectOf(items[0]!.box, 1, stage);
    // The first piece's label is tied to the first piece.
    expect(Math.abs(placed[0]!.anchor.x - (small.left + small.width / 2))).toBeLessThan(40);
  });
});
