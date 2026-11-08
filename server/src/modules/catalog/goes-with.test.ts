import type { Item } from "@closet-ai/shared";
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
