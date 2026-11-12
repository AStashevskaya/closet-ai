import { describe, expect, it } from "vitest";
import type { StylingItem } from "../outfits/outfits.repository";
import { dailyLook, needOf, pairKey, type DayNeed } from "./daily-look";

let made = 0;
const piece = (category: string, noun: string, extra: Partial<StylingItem> = {}): StylingItem => ({
  id: `p${++made}`,
  name: noun,
  category,
  colors: ["black"],
  seasons: [],
  tags: { noun } as StylingItem["tags"],
  imageKey: "k",
  embedding: null,
  ...extra,
});
const mild: DayNeed = { cold: false, hot: false, wet: false, snow: false };
const pick = (
  wardrobe: StylingItem[],
  need = mild,
  more: Partial<Parameters<typeof dailyLook>[1]> = {},
) =>
  dailyLook(wardrobe, {
    season: "autumn",
    need,
    recent: new Map(),
    struck: new Set(),
    skip: 0,
    ...more,
  });
const names = (wardrobe: StylingItem[], result: ReturnType<typeof dailyLook>) =>
  "pieces" in result ? result.pieces.map((id) => wardrobe.find((p) => p.id === id)!.name) : result;

describe("dailyLook", () => {
  it("says what the closet lacks before it can dress her", () => {
    expect(pick([piece("top", "tee")])).toEqual({ missing: ["bottom", "shoes"] });
    expect(pick([piece("dress", "dress")])).toEqual({ missing: ["shoes"] });
  });

  it("dresses her whole: a top and a bottom (or a dress), shoes, and a bag when she has one", () => {
    const wardrobe = [
      piece("top", "tee"),
      piece("bottom", "jeans"),
      piece("shoes", "loafers"),
      piece("accessory", "tote bag"),
    ];
    expect(names(wardrobe, pick(wardrobe))).toEqual(["tee", "jeans", "loafers", "tote bag"]);
  });

  it("adds a coat when it's cold, and none when it's hot", () => {
    const wardrobe = [
      piece("top", "tee"),
      piece("bottom", "jeans"),
      piece("shoes", "loafers"),
      piece("outerwear", "wool coat"),
    ];
    expect(names(wardrobe, pick(wardrobe, { ...mild, cold: true }))).toContain("wool coat");
    expect(names(wardrobe, pick(wardrobe, { ...mild, hot: true }))).not.toContain("wool coat");
  });

  it("keeps open shoes for a dry day", () => {
    const wardrobe = [
      piece("top", "tee"),
      piece("bottom", "jeans"),
      piece("shoes", "sandals"),
      piece("shoes", "ankle boots"),
    ];
    expect(names(wardrobe, pick(wardrobe, { ...mild, wet: true }))).toContain("ankle boots");
  });

  it("doesn't pair what she cut apart, and gives another look when asked", () => {
    const tee = piece("top", "tee");
    const jeans = piece("bottom", "jeans");
    const skirt = piece("bottom", "skirt");
    const wardrobe = [tee, jeans, skirt, piece("shoes", "loafers")];
    expect(
      names(wardrobe, pick(wardrobe, mild, { struck: new Set([pairKey(tee.id, jeans.id)]) })),
    ).toContain("skirt");
    const first = pick(wardrobe);
    const second = pick(wardrobe, mild, { skip: 1 });
    expect(second).not.toEqual(first);
    // Past the last distinct look it says so.
    expect(
      pick([piece("top", "t"), piece("bottom", "b"), piece("shoes", "s")], mild, { skip: 1 }),
    ).toEqual({
      exhausted: true,
    });
  });
});

describe("needOf", () => {
  it("reads the day's weather, or the season without one", () => {
    expect(needOf({ date: "d", max: 8, min: 2, sky: "rain", wet: 80 }, "autumn")).toEqual({
      cold: true,
      hot: false,
      wet: true,
      snow: false,
    });
    expect(needOf({ date: "d", max: 26, min: 18, sky: "clear", wet: 0 }, "summer")).toEqual({
      cold: false,
      hot: true,
      wet: false,
      snow: false,
    });
    expect(needOf(null, "winter")).toMatchObject({ cold: true, hot: false });
  });
});
