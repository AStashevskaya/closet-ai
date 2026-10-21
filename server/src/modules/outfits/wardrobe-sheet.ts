import type { Season } from "@closet-ai/shared";
import sharp, { type OverlayOptions } from "sharp";
import type { StylistPiece } from "../../ai/stylist";
import type { Storage } from "../../storage/storage";
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

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

// The pieces worth showing the model: in season, then per category the ones whose photos are
// closest to the item's (the embedding model also sees colour and style, so this keeps pieces
// that plausibly belong with it). Uses our own embeddings: free, unlike a bigger prompt.
export function pickCandidates(hero: StylingItem, wardrobe: StylingItem[], season: Season) {
  const slots = slotsAround(hero.category);
  const closeness = (item: StylingItem) =>
    hero.embedding && item.embedding ? dot(hero.embedding, item.embedding) : 0;
  return Object.entries(slots).flatMap(([category, take]) =>
    wardrobe
      .filter(
        (item) =>
          item.id !== hero.id &&
          item.category === category &&
          (item.seasons.length === 0 || item.seasons.includes(season)),
      )
      .sort((a, b) => closeness(b) - closeness(a))
      .slice(0, take),
  );
}

// Northern hemisphere, by month: the first markets are Israel and Eastern Europe.
export function seasonOf(date: Date): Season {
  const month = date.getUTCMonth();
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

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
