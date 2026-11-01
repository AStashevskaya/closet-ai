import { CUTOUT_PADDING } from '@closet-ai/shared';

import { cutoutFrame } from './cutout-frame';

const whole = { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };

describe('cutoutFrame', () => {
  test('a photo the frame’s shape: the piece’s box scaled, plus its padding all round', () => {
    // 100×200 frame, 1000×2000 photo: a tenth of the size.
    const frame = cutoutFrame(
      { width: 100, height: 200 },
      { width: 1000, height: 2000 },
      { xMin: 0.2, yMin: 0.25, xMax: 0.6, yMax: 0.75 },
    );
    // Piece 40×100 at (20, 50); padding 6% of its longer side (100) = 6.
    expect(frame?.left).toBeCloseTo(14);
    expect(frame?.top).toBeCloseTo(44);
    expect(frame?.width).toBeCloseTo(52);
    expect(frame?.height).toBeCloseTo(112);
  });

  test('a tall photo is centred with bands at the sides', () => {
    // 200×200 frame, 1000×2000 photo: shown 100×200 from x = 50.
    const frame = cutoutFrame({ width: 200, height: 200 }, { width: 1000, height: 2000 }, whole);
    const pad = 200 * CUTOUT_PADDING;
    expect(frame?.left).toBeCloseTo(50 - pad);
    expect(frame?.top).toBeCloseTo(-pad);
    expect(frame?.width).toBeCloseTo(100 + pad * 2);
    expect(frame?.height).toBeCloseTo(200 + pad * 2);
  });

  test('a wide photo is centred with bands above and below', () => {
    // 138×159 (the print's picture), 4000×3000 photo: shown 138×103.5 from y = 27.75.
    const frame = cutoutFrame(
      { width: 138, height: 159 },
      { width: 4000, height: 3000 },
      { xMin: 0.5, yMin: 0.5, xMax: 1, yMax: 1 },
    );
    // Piece 69×51.75 at (69, 79.5); padding 6% of 69.
    const pad = 69 * CUTOUT_PADDING;
    expect(frame?.left).toBeCloseTo(69 - pad);
    expect(frame?.top).toBeCloseTo(27.75 + 51.75 - pad);
    expect(frame?.width).toBeCloseTo(69 + pad * 2);
    expect(frame?.height).toBeCloseTo(51.75 + pad * 2);
  });

  test('the piece inside the padding lands on the piece in the photo', () => {
    const photo = { width: 3024, height: 4032 };
    const box = { xMin: 0.31, yMin: 0.12, xMax: 0.74, yMax: 0.83 };
    const frame = cutoutFrame({ width: 138, height: 159 }, photo, box);
    if (!frame) throw new Error('no frame');
    // As the server stores it: the longer side L holds the piece inset L × p / (1 + 2p).
    const longer = Math.max(frame.width, frame.height);
    const inset = (longer * CUTOUT_PADDING) / (1 + 2 * CUTOUT_PADDING);
    const scale = Math.min(138 / photo.width, 159 / photo.height);
    const offsetX = (138 - photo.width * scale) / 2;
    expect(frame.left + inset).toBeCloseTo(offsetX + box.xMin * photo.width * scale);
    expect(frame.top + inset).toBeCloseTo(box.yMin * photo.height * scale);
    expect(frame.width - inset * 2).toBeCloseTo((box.xMax - box.xMin) * photo.width * scale);
  });

  test('nothing to place without a size or with an empty box', () => {
    const frame = { width: 138, height: 159 };
    expect(cutoutFrame(frame, { width: 0, height: 0 }, whole)).toBeNull();
    expect(
      cutoutFrame(frame, { width: 100, height: 100 }, { xMin: 0.5, yMin: 0, xMax: 0.5, yMax: 1 }),
    ).toBeNull();
  });
});
