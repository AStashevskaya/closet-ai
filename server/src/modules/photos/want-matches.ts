import type { LookItem, LookMatch } from "@closet-ai/shared";
import { TaggingRefusedError } from "../../ai/item-tagger";
import type { CatalogRow } from "../catalog/catalog.repository";
import { cutOutByName, type PhotoJobDeps } from "./photo-jobs";
import { cropToBox, flattenOnWhite, processCutout, thumbnail } from "./process-photo";

// Wardrobe items the model compares each look item with: the closest by embedding. The
// embedding alone can't tell a match from a near miss (an olive jacket scored closer to a pink
// shirt than a real match did), so the model has the last word.
export const MATCH_CANDIDATES = 3;

// Partner pieces offered per look item, and how close one has to be. Measured on the owner's 5
// test screenshots against the demo catalog (2026-10-22, crops without cut-outs): a fitting
// offer scored 0.68–0.82, an unlike one of the same category 0.59–0.64.
export const SHOP_OFFERS = 3;
export const SHOP_MIN_SIMILARITY = 0.65;
// Looked at before the kind of piece is checked, so three can be left.
const SHOP_LOOK_AT = 8;

// Shoes and accessories are broad categories: sunglasses came closest to a bag, a tote to bucket
// hats. There an offer has to be the same kind of piece, by the last word of the English names
// ("top handle bag" and "Shoulder bag", "knee-high boots" and "Tall boots").
const kindOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .at(-1)!
    .replace(/s$/, "");
function sameKind(item: LookItem, offer: CatalogRow) {
  if (item.category !== "shoes" && item.category !== "accessory") return true;
  if (!item.noun || !offer.names.en) return false;
  return kindOf(item.noun) === kindOf(offer.names.en);
}

const NO_MATCH: LookMatch = { how: "none", itemId: null };

type MatchDeps = Pick<
  PhotoJobDeps,
  "photos" | "storage" | "tagger" | "embedder" | "remover" | "catalog"
>;

// "Want / Can": for each item found on a look someone else wears, the wardrobe item that is the
// same or could stand in for it. Each item is cropped from the look, cut out of its background
// when a remover is configured (wardrobe embeddings are made from cut-outs too), embedded, and
// its closest wardrobe items of the same category are shown to the model with the crop. The
// closest partner pieces come with it, by embedding alone: they are offers, not claims of a match.
export async function matchLookItems(
  { photos, storage, tagger, embedder, remover, catalog }: MatchDeps,
  ownerId: string,
  look: Uint8Array,
  items: LookItem[],
): Promise<LookMatch[]> {
  if (!tagger || !embedder) return items.map(() => NO_MATCH);

  return Promise.all(
    items.map(async (item): Promise<LookMatch> => {
      const crop = await cropToBox(look, item.box);
      // Without the cut-out the crop still matches, only less well: fal being down is no
      // reason to fail the look.
      const cut = remover
        ? await cutOutByName(remover, crop, item, { fromLook: true }).catch(() => null)
        : null;
      const query = cut ? await flattenOnWhite(await processCutout(cut)) : crop;
      const embedding = await embedder.embedImage(query);
      const offers = catalog ? await catalog.closest(item.category, embedding, SHOP_LOOK_AT) : [];
      const shop = offers
        .filter((offer) => offer.similarity >= SHOP_MIN_SIMILARITY && sameKind(item, offer))
        .slice(0, SHOP_OFFERS)
        .map((offer) => offer.id);
      const noMatch: LookMatch = { ...NO_MATCH, shop };

      const closest = await photos.closestItems(
        ownerId,
        item.category,
        embedding,
        MATCH_CANDIDATES,
      );
      if (closest.length === 0) return noMatch;

      const candidates = await Promise.all(
        closest.map(async ({ name, photoKey, cutoutKey }) => {
          const file = await storage.get(cutoutKey ?? photoKey);
          return file ? { name, image: await thumbnail(file.body) } : null;
        }),
      );
      const shown = closest.filter((_, index) => candidates[index]);
      if (shown.length === 0) return noMatch;

      try {
        const verdict = await tagger.compare(
          await thumbnail(crop),
          candidates.filter((candidate) => candidate !== null),
        );
        return verdict.index === null
          ? noMatch
          : { how: verdict.how, itemId: shown[verdict.index]!.itemId, shop };
      } catch (error) {
        // A declined comparison is one item without an answer, not a failed look.
        if (error instanceof TaggingRefusedError) return noMatch;
        throw error;
      }
    }),
  );
}
