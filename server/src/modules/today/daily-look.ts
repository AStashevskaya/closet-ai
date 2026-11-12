import type { Season } from "@closet-ai/shared";
import type { DayWeather } from "../../weather/weather";
import type { StylingItem } from "../outfits/outfits.repository";

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
// How many of each kind are tried, so a big closet stays a few thousand looks to score.
const POOL = 8;

const text = (p: StylingItem) =>
  [p.name, p.tags?.noun, p.tags?.fabric, p.tags?.style].filter(Boolean).join(" ").toLowerCase();
const kindOf = (p: StylingItem) =>
  p.category === "accessory"
    ? BAG.test(p.tags?.noun ?? p.name)
      ? "bag"
      : "accessory"
    : p.category;
const weightOf = (p: StylingItem) => (HEAVY.test(text(p)) ? 1 : LIGHT.test(text(p)) ? -1 : 0);
const registerOf = (p: StylingItem) => (DRESSY.test(text(p)) ? 1 : SPORTY.test(text(p)) ? -1 : 0);
const accents = (p: StylingItem) => p.colors.filter((c) => !NEUTRAL.has(c) && c !== "multicolor");
const dot = (a: number[] | null, b: number[] | null) =>
  a && b ? a.reduce((sum, x, i) => sum + x * b[i]!, 0) : 0;
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

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

// How well a set of pieces holds together, as rated: one story, one weight of fabric, colours that
// agree, her own refusals; and how well it suits the day.
function score(pieces: StylingItem[], need: DayNeed, struck: Set<string>) {
  let total = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]!;
      const b = pieces[j]!;
      total += 0.6 * dot(a.embedding, b.embedding);
      if (weightOf(a) * weightOf(b) === -1) total -= 1.2;
      if (registerOf(a) * registerOf(b) === -1) total -= 1;
      if (accents(a).some((c) => accents(b).includes(c))) total += 0.5;
      if (struck.has(pairKey(a.id, b.id))) total -= STRUCK_PENALTY;
    }
  }
  const colours = new Set(pieces.flatMap(accents));
  if (colours.size > 2) total -= 0.8 * (colours.size - 2);
  if (pieces.some((p) => p.colors.includes("multicolor")) && colours.size > 1) total -= 0.6;

  let weather = 0;
  for (const p of pieces) {
    const w = weightOf(p);
    if (need.cold) weather += 0.4 * w;
    if (need.hot) weather -= 0.6 * w;
    if (need.wet || need.snow) {
      if (kindOf(p) === "shoes" && OPEN_SHOES.test(text(p))) weather -= 2;
      if (WET_SHY.test(text(p))) weather -= 0.6;
      if (need.snow && kindOf(p) === "shoes" && BOOTS.test(text(p))) weather += 0.8;
    }
  }
  return total + WEATHER_WEIGHT * weather;
}

export type DailyPick = { pieces: string[] } | { missing: ("top" | "bottom" | "shoes")[] };

// The day's looks, best first: a dress alone or a top and a bottom, shoes, a bag when she has one,
// and a coat or jacket when it's cold (none when it's hot). `skip` passes over the first looks:
// "another" asks for the next. Pieces she wore lately count against a look; pairs she cut out of
// a look count strongly against it.
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
  // Pieces in season, freshest first; out of season only when the season leaves none of a kind.
  const pool = (kind: string) => {
    const all = wardrobe.filter((p) => kindOf(p) === kind);
    const inSeason = all.filter(fits);
    return (inSeason.length > 0 ? inSeason : all)
      .sort((a, b) => (recent.get(a.id) ?? 0) - (recent.get(b.id) ?? 0))
      .slice(0, POOL);
  };
  const tops = pool("top");
  const bottoms = pool("bottom");
  const dresses = pool("dress");
  const shoes = pool("shoes");
  const missing: ("top" | "bottom" | "shoes")[] = [];
  if (dresses.length === 0 && tops.length === 0) missing.push("top");
  if (dresses.length === 0 && bottoms.length === 0) missing.push("bottom");
  if (shoes.length === 0) missing.push("shoes");
  if (missing.length > 0) return { missing };

  const bases: StylingItem[][] = [
    ...dresses.map((d) => [d]),
    ...tops.flatMap((t) => bottoms.map((b) => [t, b])),
  ];
  const bags = pool("bag");
  const outer = pool("outerwear");
  const layers: (StylingItem | null)[] = need.hot ? [null] : need.cold ? outer : [null, ...outer];
  const found: { pieces: StylingItem[]; score: number }[] = [];
  for (const base of bases) {
    for (const shoe of shoes) {
      for (const bag of bags.length > 0 ? bags : [null]) {
        for (const layer of layers.length > 0 ? layers : [null]) {
          const pieces = [layer, ...base, shoe, bag].filter((p): p is StylingItem => p !== null);
          const worn = pieces.reduce((n, p) => n + (recent.get(p.id) ?? 0), 0);
          found.push({ pieces, score: score(pieces, need, struck) - WORN_PENALTY * worn });
        }
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  // Looks that differ: each shares at most two pieces with any kept before it.
  const distinct: StylingItem[][] = [];
  for (const look of found) {
    const ids = new Set(look.pieces.map((p) => p.id));
    if (distinct.some((kept) => kept.filter((p) => ids.has(p.id)).length > 2)) continue;
    distinct.push(look.pieces);
    if (distinct.length > skip) break;
  }
  const chosen = distinct[skip] ?? distinct[distinct.length - 1]!;
  return { pieces: chosen.map((p) => p.id) };
}
