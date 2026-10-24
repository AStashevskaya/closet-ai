import type { ItemCategory, Season } from "@closet-ai/shared";
import sharp, { type OverlayOptions } from "sharp";
import type { StylistPiece } from "../../ai/stylist";
import type { Storage } from "../../storage/storage";
import type { CatalogRepository, CatalogRow } from "../catalog/catalog.repository";
import type { StylingItem } from "./outfits.repository";

// How many pieces of each kind go on the contact sheet around the item: enough choice for good
// outfits, few enough that the request stays small however big the wardrobe grows.
// Bags are kept apart from the rest: every look has shoes and a bag (the owner's rule,
// 2026-10-23), and an accessory slot of hats and belts left most looks without one.
const PER_KIND: Record<string, number> = {
  top: 8,
  bottom: 6,
  dress: 4,
  outerwear: 4,
  shoes: 4,
  bag: 4,
  accessory: 2,
};

// Bags are accessories, as are hats and belts: told apart by the English type the tagger gives
// ("shoulder bag"), or by the name when there is none.
// Any word ending in "bag" ("handbag", "bumbag", "bags") counts.
const BAG =
  /bags?\b|\b(totes?|clutch|backpack|purse|satchel|crossbody)\b|сумк|клатч|рюкзак|шоппер|תיק/i;

// A shirt, by its English type or name: not a T-shirt, nor an overshirt worn as a jacket.
const SHIRT = /(?<!\bt[- ]?|\btee )\bshirt\b|рубашк/i;
export const isShirt = (piece: StylingItem | CatalogRow) =>
  piece.category === "top" &&
  SHIRT.test("names" in piece ? (piece.names.en ?? "") : `${piece.tags?.noun ?? ""} ${piece.name}`);

// A category, or "bag" for an accessory that is one.
export const kindOf = (category: string, name: string) =>
  category === "accessory" && BAG.test(name) ? "bag" : category;
export const itemKind = (item: StylingItem) => kindOf(item.category, item.tags?.noun ?? item.name);
export const catalogKind = (row: CatalogRow) =>
  kindOf(row.category, row.names.en ?? Object.values(row.names)[0] ?? "");

// What the item leaves room for: a skirt needs no second bottom, a dress no bottoms at all and
// only a top to layer, shoes or a bag no second one.
function slotsAround(heroKind: string): Record<string, number> {
  if (heroKind === "bottom") return { ...PER_KIND, bottom: 0, dress: 0 };
  if (heroKind === "dress") return { ...PER_KIND, bottom: 0, dress: 0, top: 3 };
  if (heroKind === "top") return { ...PER_KIND, top: 4, dress: 0 };
  if (heroKind === "outerwear") return { ...PER_KIND, outerwear: 0 };
  if (heroKind === "shoes") return { ...PER_KIND, shoes: 0 };
  if (heroKind === "bag") return { ...PER_KIND, bag: 0 };
  return PER_KIND;
}

// Partner pieces offered per kind: shoes and bags for looks her wardrobe can't finish, the rest
// to show a brand's piece now and then. Never a dress: it would replace the look rather than
// finish it.
const SHOP_PER_KIND: Record<string, number> = {
  shoes: 3,
  bag: 3,
  outerwear: 2,
  top: 2,
  bottom: 2,
};
// Bags are looked for among the closest accessories, which are hats and belts too.
const BAG_SEARCH = 15;

// The catalog's pieces for the shop sheet: of the kinds the item leaves room for, the ones
// closest to it (our embeddings see colour and style across categories too).
export async function pickShop(
  catalog: CatalogRepository,
  hero: StylingItem,
): Promise<CatalogRow[]> {
  if (!hero.embedding) return [];
  const slots = slotsAround(itemKind(hero));
  const picks = await Promise.all(
    Object.entries(SHOP_PER_KIND)
      .filter(([kind]) => (slots[kind] ?? 0) > 0)
      .map(async ([kind, take]) => {
        const category = (kind === "bag" ? "accessory" : kind) as ItemCategory;
        const rows = await catalog.closest(
          category,
          hero.embedding!,
          kind === "bag" ? BAG_SEARCH : take,
        );
        return rows.filter((row) => catalogKind(row) === kind).slice(0, take);
      }),
  );
  return picks.flat();
}

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

// How much the pick favours closeness to the item over being unlike the pieces already picked.
// Closeness alone gave a sheet of look-alikes, and every outfit in one aesthetic (owner's
// test, 2026-10-21).
const RELEVANCE = 0.5;

// How much each look a piece was in lately lowers its chance on the sheet, up to three looks.
// Scores differ by ~0.1 between a good and a so-so piece, so a favourite used in three recent
// looks gives way to a fresh one that fits nearly as well. Without it the same dozen pieces of a
// 61-piece wardrobe filled most looks (owner's last 32 looks, 2026-10-22).
const RECENT_PENALTY = 0.05;
const RECENT_CAP = 3;

// The pieces worth showing the model: in season, then per category a mix of pieces close to
// the item (the embedding also sees colour and style) and pieces unlike each other, picked one
// by one (maximal marginal relevance), favouring pieces her recent looks didn't use. Uses our
// own embeddings: free, unlike a bigger prompt.
export function pickCandidates(
  hero: StylingItem,
  wardrobe: StylingItem[],
  season: Season,
  recent: Map<string, number> = new Map(),
) {
  const slots = slotsAround(itemKind(hero));
  const similarity = (a: StylingItem, b: StylingItem) =>
    a.embedding && b.embedding ? dot(a.embedding, b.embedding) : 0;
  return Object.entries(slots).flatMap(([kind, take]) => {
    const pool = wardrobe.filter(
      (item) =>
        item.id !== hero.id &&
        itemKind(item) === kind &&
        (item.seasons.length === 0 || item.seasons.includes(season)),
    );
    const picked: StylingItem[] = [];
    while (picked.length < take && pool.length > 0) {
      let best = 0;
      let bestScore = -Infinity;
      for (const [i, item] of pool.entries()) {
        const sameness = Math.max(0, ...picked.map((p) => similarity(item, p)));
        const worn = Math.min(recent.get(item.id) ?? 0, RECENT_CAP);
        const score =
          RELEVANCE * similarity(hero, item) - (1 - RELEVANCE) * sameness - RECENT_PENALTY * worn;
        if (score > bestScore) [best, bestScore] = [i, score];
      }
      picked.push(pool.splice(best, 1)[0]!);
    }
    return picked;
  });
}

// Northern hemisphere, by month: the first markets are Israel and Eastern Europe.
export function seasonOf(date: Date): Season {
  const month = date.getUTCMonth();
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

// A partner piece described like a wardrobe one.
export const shopPiece = (row: CatalogRow, n: number): StylistPiece => ({
  n,
  name: row.names.en ?? Object.values(row.names)[0] ?? row.brand,
  category: row.category,
  colors: row.colors,
  seasons: [],
  details: `${row.brand}, ${row.priceMinor / 100} ${row.currency}`,
});

export const toStylistPiece = (item: StylingItem, n: number): StylistPiece => ({
  n,
  name: item.name,
  category: item.category,
  colors: item.colors,
  seasons: item.seasons,
  details: [item.tags?.fit, item.tags?.length, item.tags?.fabric, item.tags?.style]
    .filter(Boolean)
    .join(", "),
});

const CELL = 220;
const COLS = 6;

// The pieces on white with their numbers, one JPEG for the model.
export async function contactSheet(
  storage: Storage,
  pieces: { n: number; imageKey: string }[],
): Promise<Uint8Array> {
  const tiles = await Promise.all(
    pieces.map(async ({ n, imageKey }, i) => {
      const file = await storage.get(imageKey);
      const x = (i % COLS) * CELL;
      const y = Math.floor(i / COLS) * CELL;
      const label = Buffer.from(
        `<svg width="${CELL}" height="34"><text x="8" y="26" font-family="Helvetica" font-size="26" font-weight="bold" fill="#c00">${n}</text></svg>`,
      );
      const parts: OverlayOptions[] = [{ input: label, left: x, top: y }];
      if (file) {
        const thumb = await sharp(file.body)
          .resize(CELL - 20, CELL - 40, { fit: "contain", background: "#ffffff" })
          .flatten({ background: "#ffffff" })
          .png()
          .toBuffer();
        parts.push({ input: thumb, left: x + 10, top: y + 34 });
      }
      return parts;
    }),
  );
  const rows = Math.max(1, Math.ceil(pieces.length / COLS));
  return sharp({
    create: { width: COLS * CELL, height: rows * CELL, channels: 3, background: "#ffffff" },
  })
    .composite(tiles.flat())
    .jpeg({ quality: 80 })
    .toBuffer();
}

// One picture on white, for the item itself or a saved look.
export async function asJpeg(image: Uint8Array, side: number): Promise<Uint8Array> {
  return sharp(image)
    .resize(side, side, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 80 })
    .toBuffer();
}
