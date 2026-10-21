import { describe, expect, it } from "vitest";
import type { BackgroundRemover } from "../src/ai/background-remover";
import { cutOutByName } from "../src/modules/photos/photo-jobs";

// Finds the item only when asked by one of `finds`; records every name it was asked for.
function remover(finds: (string | undefined)[]) {
  const asked: { name: string | undefined; pair: boolean }[] = [];
  const fake: BackgroundRemover = {
    removeBackground: async (_image, name, options) => {
      asked.push({ name, pair: options?.pair ?? false });
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
      { name: "ankle boots", pair: true },
      { name: "boots", pair: true },
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
  });
});
