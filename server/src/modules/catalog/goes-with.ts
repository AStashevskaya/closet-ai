import type { Item, ItemCategory, ItemColor } from "@closet-ai/shared";

// Which of her pieces a partner piece goes with, by rules: no model is asked, so showing it costs
// nothing (decided 2026-11-08). It's a suggestion to look closer, not a stylist's verdict: the
// verdict comes from asking "what do I wear this with?".
// Worn together, both ways round.
const WORN_WITH: Record<ItemCategory, readonly ItemCategory[]> = {
  top: ["bottom", "outerwear", "accessory"],
  bottom: ["top", "outerwear", "shoes", "accessory"],
  dress: ["outerwear", "shoes", "accessory"],
  outerwear: ["top", "bottom", "dress", "accessory"],
  shoes: ["bottom", "dress"],
  accessory: ["top", "bottom", "dress", "outerwear"],
};
// Colours that go with anything, a print counted among them.
const NEUTRAL: ReadonlySet<ItemColor> = new Set([
  "black",
  "white",
  "cream",
  "gray",
  "beige",
  "camel",
  "brown",
  "navy",
  "khaki",
  "gold",
  "silver",
  "multicolor",
]);

type Piece = { category: ItemCategory; colors: readonly ItemColor[] };

export function goesWith(partner: Piece, hers: Piece): boolean {
  if (!WORN_WITH[partner.category].includes(hers.category)) return false;
  const neutral = (colors: readonly ItemColor[]) => colors.some((color) => NEUTRAL.has(color));
  return (
    neutral(partner.colors) ||
    neutral(hers.colors) ||
    partner.colors.some((color) => hers.colors.includes(color))
  );
}

// For each partner piece in the feed's order: how many of her pieces it goes with, and the one to
// show. That's the one shown least so far, so the feed doesn't lean on a single piece; only a
// piece with a cut-out, since it sits on the page without a frame.
export function pairWithWardrobe<P extends Piece>(
  partners: readonly P[],
  wardrobe: readonly Item[],
) {
  const shown = new Map<string, number>();
  return partners.map((partner) => {
    const matches = wardrobe.filter((piece) => goesWith(partner, piece));
    let chosen: Item | null = null;
    for (const piece of matches) {
      if (!piece.cutoutUrl) continue;
      if (!chosen || (shown.get(piece.id) ?? 0) < (shown.get(chosen.id) ?? 0)) chosen = piece;
    }
    if (!chosen) return null;
    shown.set(chosen.id, (shown.get(chosen.id) ?? 0) + 1);
    return {
      count: matches.length,
      piece: { id: chosen.id, name: chosen.name, cutoutUrl: chosen.cutoutUrl! },
    };
  });
}
