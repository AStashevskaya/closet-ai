import type { Season } from "@closet-ai/shared";
import { pairKey } from "../outfits/pair-key";
import type { StylingItem } from "../outfits/outfits.repository";
import { featuresOf, kindOf, needOf, score, type Features } from "../today/daily-look";

// "Look what turned up" (the forgotten piece, decided 2026-11-12, direction D with E inside):
// once a week a piece that has hung untouched comes forward on its rail, with three combinations
// she hasn't worn. Rules, no model, no cost. No day counts are said: it's a find, not a reproach.

// Not worn for this long: a candidate. Never worn: once it has been hers this long.
export const UNWORN_DAYS = 21;
export const NEW_DAYS = 14;
// A piece she cut out of this many looks isn't brought back.
const STRUCK_LIMIT = 3;
// The week's find is drawn from the best few, so it changes from week to week.
const SHORTLIST = 5;
const DAY_MS = 86_400_000;
// Pieces a look is built around; shoes and bags make a poor find on their own.
const PREFERRED = ["top", "dress", "outerwear"];
const ALSO = ["bottom"];
const LOOKS = 3;
const POOL = 8;

export type PieceWear = { itemId: string; lastWorn: Date | null; struck: number };
export type Candidate = { id: string; category: string; seasons: string[]; createdAt: Date };

const fits = (seasons: string[], season: Season) =>
  seasons.length === 0 || seasons.includes(season);

// A stable number for a string, to draw the week's find the same way all week.
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The week's find, or null: in season, hers, not worn in UNWORN_DAYS (or never worn and hers for
// NEW_DAYS), not cut out of looks again and again; tops, dresses and coats before bottoms; the
// longest untouched first, and among the best few one drawn by the week, so the same one stays
// all week and another may come the next. Shown once a week by the app, which keeps that.
export function pickFound(
  items: Candidate[],
  wear: PieceWear[],
  options: { season: Season; now: Date; userId: string; week: string },
): string | null {
  const byItem = new Map(wear.map((w) => [w.itemId, w]));
  const now = options.now.getTime();
  const rank = (category: string) =>
    PREFERRED.includes(category) ? 0 : ALSO.includes(category) ? 1 : null;
  const candidates = items
    .flatMap((item) => {
      const tier = rank(item.category);
      if (tier === null || !fits(item.seasons, options.season)) return [];
      const w = byItem.get(item.id);
      if ((w?.struck ?? 0) >= STRUCK_LIMIT) return [];
      const since = w?.lastWorn ? w.lastWorn.getTime() : null;
      if (since !== null && now - since < UNWORN_DAYS * DAY_MS) return [];
      if (since === null && now - item.createdAt.getTime() < NEW_DAYS * DAY_MS) return [];
      // Untouched since: the last wear, or when it came in.
      return [{ id: item.id, tier, untouched: since ?? item.createdAt.getTime() }];
    })
    .sort((a, b) => a.tier - b.tier || a.untouched - b.untouched || a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  const best = candidates.filter((c) => c.tier === candidates[0]!.tier).slice(0, SHORTLIST);
  return best[hash(`${options.userId}|${options.week}`) % best.length]!.id;
}

// Three looks with the piece in them that she hasn't worn: a dress alone, or the piece with a top
// or a bottom, shoes, a bag when she has one, and the piece as the layer if it's a coat. Scored
// by the look of the day's rules for the season (no weather: it's not for one day). A look whose
// piece and other half she has worn together is passed over; the three differ in that half.
export function looksWith(
  wardrobe: StylingItem[],
  pieceId: string,
  options: { season: Season; struck: Set<string>; wornPairs: Set<string> },
): string[][] {
  const piece = wardrobe.find((p) => p.id === pieceId);
  if (!piece) return [];
  const need = needOf(null, options.season);
  const kind = kindOf(piece);
  const of = (k: string) =>
    wardrobe
      .filter((p) => p.id !== pieceId && kindOf(p) === k && fits(p.seasons, options.season))
      .slice(0, POOL)
      .map(featuresOf);
  const hero = featuresOf(piece);
  const shoes = of("shoes");
  if (shoes.length === 0) return [];
  const bags = of("bag");
  // The piece with what completes it: the other half of a top-and-bottom look, or nothing for a
  // dress; for a coat, any base, with the coat on top.
  const halves: { base: Features[]; other: Features | null }[] =
    kind === "dress"
      ? [{ base: [hero], other: null }]
      : kind === "top"
        ? of("bottom").map((b) => ({ base: [hero, b], other: b }))
        : kind === "bottom"
          ? of("top").map((t) => ({ base: [t, hero], other: t }))
          : kind === "outerwear"
            ? [
                ...of("dress").map((d) => ({ base: [hero, d], other: d })),
                ...of("top").flatMap((t) =>
                  of("bottom").map((b) => ({ base: [hero, t, b], other: t })),
                ),
              ]
            : [];
  const alike = (a: Features, b: Features) =>
    a.embedding && b.embedding
      ? a.embedding.reduce((sum, x, i) => sum + x * b.embedding![i]!, 0)
      : 0;
  const found: { pieces: Features[]; key: string; score: number }[] = [];
  for (const { base, other } of halves) {
    if (other && options.wornPairs.has(pairKey(pieceId, other.id))) continue;
    for (const shoe of shoes) {
      for (const bag of bags.length > 0 ? bags : [null]) {
        const pieces = [...base, shoe, bag].filter((p): p is Features => p !== null);
        found.push({
          pieces,
          // What makes two looks different: the other half, or for a dress the shoes.
          key: other?.id ?? shoe.id,
          score: score(pieces, need, options.struck, alike),
        });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const looks: string[][] = [];
  const keys = new Set<string>();
  for (const look of found) {
    if (keys.has(look.key)) continue;
    keys.add(look.key);
    looks.push(look.pieces.map((p) => p.id));
    if (looks.length === LOOKS) break;
  }
  return looks;
}
