import { describe, expect, it } from "vitest";
import type { StylingItem } from "./outfits.repository";
import { pickCandidates } from "./wardrobe-sheet";

const piece = (id: string, category: string, embedding: number[]): StylingItem => ({
  id,
  name: id,
  category,
  colors: ["white"],
  seasons: [],
  tags: null,
  imageKey: `${id}.webp`,
  embedding,
});

describe("pickCandidates", () => {
  // Shoes get four places on the sheet: six pairs, two a little closer to the skirt than the rest.
  const skirt = piece("skirt", "bottom", [1, 0]);
  const shoes = [
    piece("favourite-1", "shoes", [0.95, 0.31]),
    piece("favourite-2", "shoes", [0.94, 0.34]),
    ...["a", "b", "c", "d"].map((id) => piece(id, "shoes", [0.9, 0.44])),
  ];
  const picked = (recent?: Map<string, number>) =>
    pickCandidates(skirt, [skirt, ...shoes], "autumn", recent).map((item) => item.id);

  it("gives the closest pieces their place on the sheet", () => {
    expect(picked()).toEqual(expect.arrayContaining(["favourite-1", "favourite-2"]));
  });

  it("makes room for fresh pieces when the closest ones were in many recent looks", () => {
    const recent = new Map([
      ["favourite-1", 5],
      ["favourite-2", 3],
    ]);
    expect(picked(recent)).not.toContain("favourite-1");
    expect(picked(recent)).toHaveLength(4);
  });
});
