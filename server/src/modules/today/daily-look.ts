import type { Season } from "@closet-ai/shared";
import type { DayWeather } from "../../weather/weather";
import { pairKey } from "../outfits/pair-key";
import type { StylingItem } from "../outfits/outfits.repository";

export { pairKey };

// The look of the day, built by rules on the server: no model, no cost (owner, 2026-11-12). The
// rules are the ones rated against the stylist on 2026-11-10 (wrinkle-lab/outfit-eval/rules.mjs,
// 3.37 against 3.42 for someone with no likes yet), with the day's weather on top.

const NEUTRAL = new Set(["black", "white", "gray", "beige", "brown"]);
const BAG = /\b(bag|tote|clutch|backpack|purse|crossbody|handbag)\b/i;
const HEAVY = /wool|tweed|leather|suede|fur|shearling|puffer|down|fleece|corduroy|heavy|knit/i;
const LIGHT = /linen|silk|satin|chiffon|lace|mesh|sheer|gauze|light/i;
const DRESSY = /evening|formal|elegant|glam|party|cocktail|sequin|satin|silk|lace/i;
const SPORTY = /sport|athlet|street|casual|sneaker|denim|hoodie|jersey/i;
// Shoes that don't belong in rain or snow, and fabrics that don't either.
const OPEN_SHOES = /sandal|flip|slide|mule|ballet|espadrille|slingback|open/i;
const WET_SHY = /suede|satin|silk|canvas/i;
const BOOTS = /boot/i;

// How much each signal counts.
const WORN_PENALTY = 0.25;
const STRUCK_PENALTY = 3;
// The weather's say: strong, since a look wrong for the day is no use however well it matches.
const WEATHER_WEIGHT = 1.5;
// How many of each kind are tried: 8 tops and bottoms (or dresses), 4 shoes, 3 bags and 3
// layers keep a big closet under ten thousand looks, scored in a few milliseconds.
const POOL = 8;
const POOL_SHOES = 4;
const POOL_SMALL = 3;

const text = (p: StylingItem) =>
  [p.name, p.tags?.noun, p.tags?.fabric, p.tags?.style].filter(Boolean).join(" ").toLowerCase();
const kindOf = (p: StylingItem) =>
  p.category === "accessory"
    ? BAG.test(p.tags?.noun ?? p.name)
      ? "bag"
      : "accessory"
    : p.category;
const dot = (a: number[] | null, b: number[] | null) =>
  a && b ? a.reduce((sum, x, i) => sum + x * b[i]!, 0) : 0;

// What the day asks of clothes.
export type DayNeed = { cold: boolean; hot: boolean; wet: boolean; snow: boolean };
export function needOf(day: DayWeather | null, season: Season): DayNeed {
  if (!day) {
    return {
      cold: season === "winter" || season === "autumn",
      hot: season === "summer",
      wet: false,
      snow: false,
    };
  }
  return {
    cold: day.max < 12,
    hot: day.max >= 22,
    wet: day.sky === "rain" || day.sky === "storm" || day.wet >= 60,
    snow: day.sky === "snow",
  };
}

// What the rules read about a piece, worked out once per piece rather than once per pair.
type Features = {
  id: string;
  kind: string;
  weight: number;
  register: number;
  accents: string[];
  multicolor: boolean;
  openShoe: boolean;
  wetShy: boolean;
  boots: boolean;
  embedding: number[] | null;
};
const featuresOf = (p: StylingItem): Features => {
  const words = text(p);
  return {
    id: p.id,
    kind: kindOf(p),
    weight: HEAVY.test(words) ? 1 : LIGHT.test(words) ? -1 : 0,
    register: DRESSY.test(words) ? 1 : SPORTY.test(words) ? -1 : 0,
    accents: p.colors.filter((c) => !NEUTRAL.has(c) && c !== "multicolor"),
    multicolor: p.colors.includes("multicolor"),
    openShoe: OPEN_SHOES.test(words),
    wetShy: WET_SHY.test(words),
    boots: BOOTS.test(words),
    embedding: p.embedding,
  };
};

// How well a set of pieces holds together, as rated: one story, one weight of fabric, colours that
// agree, her own refusals; and how well it suits the day.
function score(
  pieces: Features[],
  need: DayNeed,
  struck: Set<string>,
  // How alike two pieces are, worked out once per pair: the costly part of the score.
  alike: (a: Features, b: Features) => number,
) {
  let total = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]!;
      const b = pieces[j]!;
      total += 0.6 * alike(a, b);
      if (a.weight * b.weight === -1) total -= 1.2;
      if (a.register * b.register === -1) total -= 1;
      if (a.accents.some((c) => b.accents.includes(c))) total += 0.5;
      if (struck.has(pairKey(a.id, b.id))) total -= STRUCK_PENALTY;
    }
  }
  const colours = new Set(pieces.flatMap((p) => p.accents));
  if (colours.size > 2) total -= 0.8 * (colours.size - 2);
  if (pieces.some((p) => p.multicolor) && colours.size > 1) total -= 0.6;

  let weather = 0;
  for (const p of pieces) {
    if (need.cold) weather += 0.4 * p.weight;
    if (need.hot) weather -= 0.6 * p.weight;
    if (need.wet || need.snow) {
      if (p.kind === "shoes" && p.openShoe) weather -= 2;
      if (p.wetShy) weather -= 0.6;
      if (need.snow && p.kind === "shoes" && p.boots) weather += 0.8;
    }
  }
  return total + WEATHER_WEIGHT * weather;
}

// A look's pieces, or what the closet lacks for one, or that every distinct look has been shown.
export type DailyPick =
  { pieces: string[] } | { missing: ("top" | "bottom" | "shoes")[] } | { exhausted: true };

// The day's looks, best first: a dress alone or a top and a bottom, shoes, a bag when she has one,
// and a coat or jacket when it's cold (none when it's hot). `skip` passes over the looks already
// shown ("another"); past the last distinct one it says so rather than repeat one. Pieces she wore
// lately count against a look; pairs she cut out of a look count strongly against it.
export function dailyLook(
  wardrobe: StylingItem[],
  options: {
    season: Season;
    need: DayNeed;
    recent: Map<string, number>;
    struck: Set<string>;
    skip: number;
  },
): DailyPick {
  const { season, need, recent, struck, skip } = options;
  const fits = (p: StylingItem) => p.seasons.length === 0 || p.seasons.includes(season);
  // Pieces in season, freshest first (then in closet order); out of season only when the season
  // leaves none of a kind.
  const pool = (kind: string, size: number) => {
    const all = wardrobe.filter((p) => kindOf(p) === kind);
    const inSeason = all.filter(fits);
    return (inSeason.length > 0 ? inSeason : all)
      .map((p, order) => ({ p, worn: recent.get(p.id) ?? 0, order }))
      .sort((a, b) => a.worn - b.worn || a.order - b.order)
      .slice(0, size)
      .map(({ p }) => featuresOf(p));
  };
  const tops = pool("top", POOL);
  const bottoms = pool("bottom", POOL);
  const dresses = pool("dress", POOL);
  const shoes = pool("shoes", POOL_SHOES);
  const missing: ("top" | "bottom" | "shoes")[] = [];
  if (dresses.length === 0 && tops.length === 0) missing.push("top");
  if (dresses.length === 0 && bottoms.length === 0) missing.push("bottom");
  if (shoes.length === 0) missing.push("shoes");
  if (missing.length > 0) return { missing };

  const bases: Features[][] = [
    ...dresses.map((d) => [d]),
    ...tops.flatMap((t) => bottoms.map((b) => [t, b])),
  ];
  const bags = pool("bag", POOL_SMALL);
  const outer = pool("outerwear", POOL_SMALL);
  const layers: (Features | null)[] = need.hot ? [null] : need.cold ? outer : [null, ...outer];
  const alikeness = new Map<string, number>();
  const alike = (a: Features, b: Features) => {
    const key = pairKey(a.id, b.id);
    let value = alikeness.get(key);
    if (value === undefined) {
      value = dot(a.embedding, b.embedding);
      alikeness.set(key, value);
    }
    return value;
  };
  const found: { pieces: Features[]; score: number }[] = [];
  for (const base of bases) {
    for (const shoe of shoes) {
      for (const bag of bags.length > 0 ? bags : [null]) {
        for (const layer of layers.length > 0 ? layers : [null]) {
          const pieces = [layer, ...base, shoe, bag].filter((p): p is Features => p !== null);
          const worn = pieces.reduce((n, p) => n + (recent.get(p.id) ?? 0), 0);
          found.push({ pieces, score: score(pieces, need, struck, alike) - WORN_PENALTY * worn });
        }
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  // Looks that differ: each shares at most two pieces with any kept before it. A small closet may
  // not have that many, so then a look counts as new when its top, bottom or dress is.
  const baseOf = (look: Features[]) =>
    look
      .filter((p) => p.kind === "top" || p.kind === "bottom" || p.kind === "dress")
      .map((p) => p.id)
      .sort()
      .join("|");
  const distinct: Features[][] = [];
  for (const look of found) {
    const ids = new Set(look.pieces.map((p) => p.id));
    if (distinct.some((kept) => kept.filter((p) => ids.has(p.id)).length > 2)) continue;
    distinct.push(look.pieces);
    if (distinct.length > skip) break;
  }
  if (distinct.length <= skip) {
    const bases = new Set(distinct.map(baseOf));
    for (const look of found) {
      if (bases.has(baseOf(look.pieces))) continue;
      bases.add(baseOf(look.pieces));
      distinct.push(look.pieces);
      if (distinct.length > skip) break;
    }
  }
  const chosen = distinct[skip];
  if (!chosen) return { exhausted: true };
  return { pieces: chosen.map((p) => p.id) };
}
