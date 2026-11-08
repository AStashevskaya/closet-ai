import { ITEM_CATEGORIES, type Item } from "@closet-ai/shared";
import { describe, expect, it } from "vitest";
import { goesWith, pairWithWardrobe } from "./goes-with";

const piece = (id: string, over: Partial<Item> = {}) =>
  ({
    id,
    name: id,
    category: "bottom",
    colors: ["black"],
    cutoutUrl: `/cut/${id}`,
    ...over,
  }) as Item;

describe("goesWith", () => {
  it("needs a category worn together and colours that work", () => {
    const red = { category: "top", colors: ["red"] } as const;
    expect(goesWith(red, { category: "bottom", colors: ["black"] })).toBe(true);
    expect(goesWith(red, { category: "bottom", colors: ["red"] })).toBe(true);
    expect(goesWith(red, { category: "bottom", colors: ["green"] })).toBe(false);
    expect(goesWith(red, { category: "top", colors: ["black"] })).toBe(false);
  });

  it("takes a print as going with anything", () => {
    const print = { category: "top", colors: ["multicolor"] } as const;
    expect(goesWith(print, { category: "bottom", colors: ["green"] })).toBe(true);
  });

  it("keeps a dress from tops and bottoms, and pairs an accessory with most things", () => {
    const dress = { category: "dress", colors: ["black"] } as const;
    expect(goesWith(dress, { category: "top", colors: ["black"] })).toBe(false);
    expect(goesWith(dress, { category: "bottom", colors: ["black"] })).toBe(false);
    const bag = { category: "accessory", colors: ["black"] } as const;
    expect(goesWith(bag, { category: "bottom", colors: ["blue"] })).toBe(true);
    expect(goesWith(bag, { category: "shoes", colors: ["black"] })).toBe(false);
  });

  it("works the same both ways round", () => {
    for (const a of ITEM_CATEGORIES) {
      for (const b of ITEM_CATEGORIES) {
        const one = goesWith(
          { category: a, colors: ["black"] },
          { category: b, colors: ["black"] },
        );
        const other = goesWith(
          { category: b, colors: ["black"] },
          { category: a, colors: ["black"] },
        );
        expect(`${a}/${b}: ${one}`).toBe(`${a}/${b}: ${other}`);
      }
    }
  });
});

describe("pairWithWardrobe", () => {
  const top = { category: "top", colors: ["white"] } as const;

  it("counts every match and shares the feed between her pieces", () => {
    const pairs = pairWithWardrobe([top, top, top], [piece("a"), piece("b")]);
    expect(pairs.map((pair) => pair?.piece.id)).toEqual(["a", "b", "a"]);
    expect(pairs[0]?.count).toBe(2);
  });

  it("counts a piece without a cut-out but doesn't show it", () => {
    const pairs = pairWithWardrobe([top], [piece("a", { cutoutUrl: undefined }), piece("b")]);
    expect(pairs[0]).toMatchObject({ count: 2, piece: { id: "b" } });
  });

  it("has nothing to say without a match, or a piece to show", () => {
    expect(pairWithWardrobe([top], [])).toEqual([null]);
    expect(pairWithWardrobe([top], [piece("a", { cutoutUrl: undefined })])).toEqual([null]);
  });
});
