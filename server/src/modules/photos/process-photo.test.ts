import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { modelCopy, PHOTO_MAX_PIXELS, processPhoto } from "./process-photo.js";

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
