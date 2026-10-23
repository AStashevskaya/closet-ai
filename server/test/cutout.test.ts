import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { maskWithTrim, type BackgroundRemover } from "../src/ai/background-remover";
import { cutOutByName } from "../src/modules/photos/photo-jobs";

// Finds the item only when asked by one of `finds`; records every name it was asked for.
function remover(finds: (string | undefined)[]) {
  const asked: { name: string | undefined; pair: boolean; trim: boolean }[] = [];
  const fake: BackgroundRemover = {
    removeBackground: async (_image, name, options) => {
      asked.push({ name, pair: options?.pair ?? false, trim: options?.trim ?? false });
      return finds.includes(name) ? new Uint8Array([1]) : null;
    },
  };
  return { fake, asked };
}

const image = new Uint8Array([0]);

describe("cutOutByName", () => {
  it("cuts clothes out as a garment, and asks by type only when that finds nothing", async () => {
    const found = remover([undefined]);
    expect(
      await cutOutByName(found.fake, image, { category: "bottom", noun: "sequin mini skirt" }),
    ).not.toBeNull();
    expect(found.asked.map((a) => a.name)).toEqual([undefined]);

    const missed = remover(["skirt"]);
    expect(
      await cutOutByName(missed.fake, image, { category: "bottom", noun: "sequin mini skirt" }),
    ).not.toBeNull();
    expect(missed.asked.map((a) => a.name)).toEqual([undefined, "sequin mini skirt", "skirt"]);
  });

  it("asks for shoes by type, as a pair, and falls back to shoes", async () => {
    const boots = remover(["boots"]);
    await cutOutByName(boots.fake, image, { category: "shoes", noun: "ankle boots" });
    expect(boots.asked).toEqual([
      { name: "ankle boots", pair: true, trim: false },
      { name: "boots", pair: true, trim: false },
    ]);

    const old = remover([]);
    expect(await cutOutByName(old.fake, image, { category: "shoes", noun: null })).toBeNull();
    // Never "garment": it finds nothing on shoes.
    expect(old.asked.map((a) => a.name)).toEqual(["shoes"]);
  });

  it("asks a crop from a look by type first", async () => {
    const look = remover([undefined]);
    await cutOutByName(
      look.fake,
      image,
      { category: "bottom", noun: "leather midi skirt" },
      { fromLook: true },
    );
    expect(look.asked.map((a) => a.name)).toEqual(["leather midi skirt", "skirt", undefined]);
    // Asked by type, it keeps the trim the type leaves out ("garment" itself has it already).
    expect(look.asked.map((a) => a.trim)).toEqual([true, true, false]);
  });
});

// A white rectangle on black, as SAM 3 returns masks: x, y, width, height on a 100 × 100 photo.
const rect = (left: number, top: number, width: number, height: number) =>
  sharp({ create: { width: 100, height: 100, channels: 3, background: "black" } })
    .composite([
      {
        input: { create: { width, height, channels: 3, background: "white" } },
        left,
        top,
      },
    ])
    .png()
    .toBuffer();

describe("maskWithTrim", () => {
  it("takes the piece with its trim, not a piece beside it or the whole look", async () => {
    const sweater = await rect(20, 20, 40, 40);
    const withFeathers = await rect(20, 20, 50, 60);
    const shorts = await rect(60, 70, 30, 20);
    const wholeLook = await rect(0, 0, 100, 100);
    expect(await maskWithTrim(sweater, [shorts, withFeathers, wholeLook])).toBe(withFeathers);
    // "garment" finds the sweater just as the name did: nothing to add.
    expect(await maskWithTrim(sweater, [await rect(20, 20, 40, 40), shorts])).toBeNull();
  });
});
