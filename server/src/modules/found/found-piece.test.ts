import { describe, expect, it } from "vitest";
import { pairKey } from "../outfits/pair-key";
import type { StylingItem } from "../outfits/outfits.repository";
import { looksWith, pickFound, type Candidate } from "./found-piece";

const now = new Date("2026-11-12T08:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const candidate = (
  id: string,
  category: string,
  added = 60,
  seasons: string[] = [],
): Candidate => ({
  id,
  category,
  seasons,
  createdAt: daysAgo(added),
});
const options = { season: "autumn" as const, now, userId: "u1", week: "2026-11-09" };

describe("pickFound", () => {
  it("brings back a piece untouched for weeks, never one worn lately or just bought", () => {
    const items = [
      candidate("worn-lately", "top"),
      candidate("just-bought", "top", 5),
      candidate("forgotten", "top"),
    ];
    const wear = [
      { itemId: "worn-lately", lastWorn: daysAgo(3), struck: 0 },
      { itemId: "forgotten", lastWorn: daysAgo(40), struck: 0 },
    ];
    expect(pickFound(items, wear, options)).toEqual(["forgotten"]);
  });

  it("leaves out shoes and bags, pieces out of season and pieces she keeps cutting", () => {
    const items = [
      candidate("shoes", "shoes"),
      candidate("bag", "accessory"),
      candidate("summer", "dress", 60, ["summer"]),
      candidate("cut", "top"),
    ];
    const wear = [{ itemId: "cut", lastWorn: null, struck: 3 }];
    expect(pickFound(items, wear, options)).toEqual([]);
  });

  it("prefers tops, dresses and coats to bottoms", () => {
    const items = [candidate("skirt", "bottom", 300), candidate("coat", "outerwear", 30)];
    // The skirt is still there, after the coat, should the coat have nothing to go with.
    expect(pickFound(items, [], options)).toEqual(["coat", "skirt"]);
  });

  it("keeps the same find all week, from the few untouched longest", () => {
    const items = Array.from({ length: 9 }, (_, i) => candidate(`top-${i}`, "top", 30 + i));
    const [pick, ...rest] = pickFound(items, [], options);
    expect(pickFound(items, [], { ...options, now: daysAgo(-3) })[0]).toBe(pick);
    // The five untouched longest (added 34 to 38 days ago) first, then the others.
    expect(["top-4", "top-5", "top-6", "top-7", "top-8"]).toContain(pick);
    expect(
      rest.slice(0, 4).every((id) => ["top-4", "top-5", "top-6", "top-7", "top-8"].includes(id)),
    ).toBe(true);
    expect(rest.slice(4).sort()).toEqual(["top-0", "top-1", "top-2", "top-3"]);
  });
});

const piece = (id: string, category: string, name = id): StylingItem => ({
  id,
  name,
  category,
  colors: ["black"],
  seasons: [],
  tags: null,
  imageKey: `${id}.webp`,
  embedding: null,
});

describe("looksWith", () => {
  const wardrobe = [
    piece("cardigan", "top"),
    piece("jeans", "bottom"),
    piece("skirt", "bottom"),
    piece("trousers", "bottom"),
    piece("shorts", "bottom"),
    piece("loafers", "shoes"),
    piece("tote", "accessory", "tote bag"),
  ];
  const opts = {
    season: "autumn" as const,
    struck: new Set<string>(),
    wornPairs: new Set<string>(),
  };

  it("gives three looks with the piece, each with a different other half, shoes and a bag", () => {
    const looks = looksWith(wardrobe, "cardigan", opts);
    expect(looks).toHaveLength(3);
    for (const look of looks) {
      expect(look).toContain("cardigan");
      expect(look).toContain("loafers");
      expect(look).toContain("tote");
    }
    const halves = looks.map((look) =>
      look.find((id) => id !== "cardigan" && id !== "loafers" && id !== "tote"),
    );
    expect(new Set(halves).size).toBe(3);
  });

  it("passes over what she has worn it with", () => {
    const looks = looksWith(wardrobe, "cardigan", {
      ...opts,
      wornPairs: new Set([pairKey("cardigan", "jeans"), pairKey("cardigan", "skirt")]),
    });
    expect(looks.flat()).not.toContain("jeans");
    expect(looks.flat()).not.toContain("skirt");
    expect(looks).toHaveLength(2);
  });

  it("leaves out what she wore with it before cutting the pool, so a long history still leaves looks", () => {
    const many = Array.from({ length: 10 }, (_, i) => piece(`bottom-${i}`, "bottom"));
    const looks = looksWith(
      [piece("cardigan", "top"), ...many, piece("loafers", "shoes")],
      "cardigan",
      {
        ...opts,
        // The first eight, which alone would fill the pool, she has worn with it.
        wornPairs: new Set(many.slice(0, 8).map((b) => pairKey("cardigan", b.id))),
      },
    );
    expect(
      looks
        .flat()
        .filter((id) => id.startsWith("bottom-"))
        .sort(),
    ).toEqual(["bottom-8", "bottom-9"]);
  });

  it("checks every piece of a coat's base against what she wore it with", () => {
    const looks = looksWith(
      [
        piece("coat", "outerwear"),
        piece("tee", "top"),
        piece("jeans", "bottom"),
        piece("skirt", "bottom"),
        piece("boots", "shoes"),
      ],
      "coat",
      { ...opts, wornPairs: new Set([pairKey("coat", "jeans")]) },
    );
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.flat()).not.toContain("jeans");
  });

  it("has nothing without shoes", () => {
    expect(
      looksWith(
        wardrobe.filter((p) => p.category !== "shoes"),
        "cardigan",
        opts,
      ),
    ).toEqual([]);
  });
});
