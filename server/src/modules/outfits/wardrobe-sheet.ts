import type { ItemCategory, Season } from "@closet-ai/shared";
import sharp, { type OverlayOptions } from "sharp";
import type { StylistPiece } from "../../ai/stylist";
import type { Storage } from "../../storage/storage";
import type { CatalogRepository, CatalogRow } from "../catalog/catalog.repository";
import type { StylingItem } from "./outfits.repository";

// How many pieces of each kind go on the contact sheet around the item: enough choice for good
// outfits, few enough that the request stays small however big the wardrobe grows.
const PER_CATEGORY: Record<string, number> = {
  top: 8,
  bottom: 6,
  dress: 4,
  outerwear: 4,
  shoes: 4,
  accessory: 3,
};

// What the item's own category leaves room for: a skirt needs no second bottom, a dress no
// bottoms at all and only a top to layer.
function slotsAround(heroCategory: string): Record<string, number> {
  if (heroCategory === "bottom") return { ...PER_CATEGORY, bottom: 0 };
  if (heroCategory === "dress") return { ...PER_CATEGORY, bottom: 0, dress: 0, top: 3 };
  if (heroCategory === "top") return { ...PER_CATEGORY, top: 4 };
  if (heroCategory === "outerwear") return { ...PER_CATEGORY, outerwear: 0 };
  return PER_CATEGORY;
}

// Partner pieces offered per category: where a missing piece is most often the finishing touch.
// Never a dress: it would replace the look rather than finish it.
const SHOP_PER_CATEGORY: Record<string, number> = {
  shoes: 3,
  accessory: 3,
  outerwear: 2,
  top: 2,
  bottom: 2,
};

// The catalog's pieces for the shop sheet: in the categories the item leaves room for, the ones
// closest to it (our embeddings see colour and style across categories too). The stylist then
// takes one only where the wardrobe falls short.
export async function pickShop(
  catalog: CatalogRepository,
  hero: StylingItem,
): Promise<CatalogRow[]> {
  if (!hero.embedding) return [];
  const slots = slotsAround(hero.category);
  const picks = await Promise.all(
    Object.entries(SHOP_PER_CATEGORY)
      .filter(([category]) => (slots[category] ?? 0) > 0)
      .map(([category, take]) => catalog.closest(category as ItemCategory, hero.embedding!, take)),
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
  const slots = slotsAround(hero.category);
  const similarity = (a: StylingItem, b: StylingItem) =>
    a.embedding && b.embedding ? dot(a.embedding, b.embedding) : 0;
  return Object.entries(slots).flatMap(([category, take]) => {
    const pool = wardrobe.filter(
      (item) =>
        item.id !== hero.id &&
        item.category === category &&
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
