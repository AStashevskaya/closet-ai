import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { CUTOUT_PADDING } from "@closet-ai/shared";
import {
  isWhole,
  modelCopy,
  PHOTO_MAX_PIXELS,
  processCutout,
  processPhoto,
  rotateBoxQuarter,
} from "./process-photo.js";

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c9b8a0" } })
    .jpeg()
    .toBuffer();

describe("photo sizes", () => {
  it("stores photos sharp enough to crop into, and sends models a smaller copy", async () => {
    const stored = await processPhoto(await photo(3000, 2000));
    const { width = 0, height = 0 } = await sharp(stored).metadata();
    expect(width * height).toBeLessThanOrEqual(PHOTO_MAX_PIXELS * 1.01);
    expect(width / height).toBeCloseTo(1.5, 2);

    const forModel = await sharp(await modelCopy(stored)).metadata();
    expect(forModel).toMatchObject({ width: 1024, height: 683 });
  });

  it("keeps a tall phone screenshot wide enough for a full-width cover", async () => {
    const stored = await processPhoto(await photo(1170, 2532));
    expect((await sharp(stored).metadata()).width).toBeGreaterThan(1050);
  });

  it("never enlarges a small photo for the model", async () => {
    const small = await processPhoto(await photo(800, 600));
    expect((await sharp(await modelCopy(small)).metadata()).width).toBe(800);
  });
});

// A transparent 200×200 cut-out with opaque squares at the given spots: [left, top, side].
const cutout = (...squares: [number, number, number][]) =>
  sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(
      squares.map(([left, top, side]) => ({
        input: {
          create: { width: side, height: side, channels: 4 as const, background: "#7a5032" },
        },
        left,
        top,
      })),
    )
    .png()
    .toBuffer();

describe("isWhole", () => {
  it("takes an item in one piece, crumbs at its edge aside", async () => {
    expect(await isWhole(await cutout([20, 20, 150], [190, 190, 4]), "top")).toBe(true);
  });

  it("refuses a garment broken into bits around what covered it", async () => {
    // Like the worn shirt: the biggest piece about 60% of the whole.
    const broken = await cutout([0, 0, 100], [120, 0, 60], [120, 120, 50]);
    expect(await isWhole(broken, "top")).toBe(false);
  });

  it("takes a pair of shoes as two pieces, but not clothes in two halves", async () => {
    const pair = await cutout([10, 50, 80], [110, 50, 80]);
    expect(await isWhole(pair, "shoes")).toBe(true);
    expect(await isWhole(pair, "bottom")).toBe(false);
  });

  it("refuses an empty cut-out", async () => {
    expect(await isWhole(await cutout(), "top")).toBe(false);
  });
});

// What the remover returns: the whole photo, transparent but for one opaque piece at
// [left, top, width, height] in pixels.
const removerPng = (
  width: number,
  height: number,
  [left, top, pieceWidth, pieceHeight]: [number, number, number, number],
) =>
  sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: { width: pieceWidth, height: pieceHeight, channels: 4, background: "#7a5032" },
        },
        left,
        top,
      },
    ])
    .png()
    .toBuffer();

describe("processCutout", () => {
  const box = { xMin: 0.1, yMin: 0.2, xMax: 0.6, yMax: 0.5 };

  it("records where the piece sits in the photo, and pads the stored cut-out", async () => {
    const { webp, box: found } = await processCutout(await removerPng(400, 300, [40, 60, 200, 90]));
    expect(found).toEqual(box);
    // The piece plus CUTOUT_PADDING of its longer side all round.
    const pad = Math.round(200 * CUTOUT_PADDING);
    expect(await sharp(webp).metadata()).toMatchObject({
      width: 200 + 2 * pad,
      height: 90 + 2 * pad,
      hasAlpha: true,
    });
  });

  it("gives the same box when the remover answers at another size than the photo", async () => {
    // The same photo as above, at 2.5×: a share of the PNG is the same share of the photo.
    const { box: found } = await processCutout(await removerPng(1000, 750, [100, 150, 500, 225]));
    expect(found).toEqual(box);
  });

  it("spans the whole photo when the piece reaches every edge", async () => {
    const { box: found } = await processCutout(await removerPng(120, 80, [0, 0, 120, 80]));
    expect(found).toEqual({ xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
  });

  it("turns the box as the photo is turned a quarter clockwise", async () => {
    const png = await removerPng(400, 300, [40, 60, 200, 90]);
    const turned = await sharp(png).rotate(90).png().toBuffer();
    const { box: found } = await processCutout(turned);
    const expected = rotateBoxQuarter(box);
    for (const side of ["xMin", "yMin", "xMax", "yMax"] as const) {
      expect(found[side]).toBeCloseTo(expected[side], 10);
    }
  });
});
