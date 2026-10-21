import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { modelCopy, PHOTO_MAX_SIDE, processPhoto } from "./process-photo.js";

const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c9b8a0" } })
    .jpeg()
    .toBuffer();

describe("photo sizes", () => {
  it("stores photos sharp enough to crop into, and sends models a smaller copy", async () => {
    const stored = await processPhoto(await photo(3000, 2000));
    expect((await sharp(stored).metadata()).width).toBe(PHOTO_MAX_SIDE);

    const forModel = await sharp(await modelCopy(stored)).metadata();
    expect(forModel).toMatchObject({ width: 1024, height: 683 });
  });

  it("never enlarges a small photo for the model", async () => {
    const small = await processPhoto(await photo(800, 600));
    expect((await sharp(await modelCopy(small)).metadata()).width).toBe(800);
  });
});
