import { describe, expect, it } from "vitest";
import type { StylingItem } from "./outfits.repository";
import { isShirt, kindOf, pickCandidates } from "./wardrobe-sheet";

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

describe("bags on the sheet", () => {
  // Hats closer to the skirt than the bag: with one accessory slot the bag lost its place.
  const skirt = piece("skirt", "bottom", [1, 0]);
  const hats = ["hat-1", "hat-2", "hat-3"].map((id) => piece(id, "accessory", [0.99, 0.1]));
  const bag = piece("Blue suede shoulder bag", "accessory", [0.5, 0.87]);

  it("keeps a place for bags apart from other accessories", () => {
    const ids = pickCandidates(skirt, [skirt, ...hats, bag], "autumn").map((item) => item.id);
    expect(ids).toContain(bag.id);
    expect(ids.filter((id) => id.startsWith("hat"))).toHaveLength(2);
  });

  it("tells a bag by its type, in any of the app's languages", () => {
    expect(kindOf("accessory", "shoulder bag")).toBe("bag");
    expect(kindOf("accessory", "Голубая замшевая сумка")).toBe("bag");
    expect(kindOf("accessory", "felt fedora hat")).toBe("accessory");
    expect(kindOf("shoes", "bag-like loafers")).toBe("shoes");
  });
});

describe("isShirt", () => {
  const top = (name: string) => piece(name, "top", [1, 0]);

  it("tells a shirt from a T-shirt and an overshirt", () => {
    expect(isShirt(top("Light blue striped shirt"))).toBe(true);
    expect(isShirt(top("Розовая клетчатая рубашка"))).toBe(true);
    expect(isShirt(top("Grey cotton t-shirt"))).toBe(false);
    expect(isShirt(top("White corduroy overshirt"))).toBe(false);
    expect(isShirt(piece("Shirt dress", "dress", [1, 0]))).toBe(false);
  });
});
