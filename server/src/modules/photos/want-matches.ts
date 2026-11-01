import type { LookItem, LookMatch } from "@closet-ai/shared";
import type { ItemEmbedder } from "../../ai/item-embedder";
import { TaggingRefusedError } from "../../ai/item-tagger";
import type { CatalogRepository } from "../catalog/catalog.repository";
import { kindOf, offerText, POOL_BY_IMAGE, POOL_BY_KIND, rankOffers } from "./offer-ranker";
import { cutOutByName, type PhotoJobDeps } from "./photo-jobs";
import { cropToBox, flattenOnWhite, processCutout, thumbnail } from "./process-photo";

// Wardrobe items the model compares each look item with: the closest by embedding. The
// embedding alone can't tell a match from a near miss (an olive jacket scored closer to a pink
// shirt than a real match did), so the model has the last word.
export const MATCH_CANDIDATES = 3;

const NO_MATCH: LookMatch = { how: "none", itemId: null };

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

// The partner pieces offered for a look item, best first: the pool the ranker was trained on
// (closest by image, plus a few of the same kind by name), scored with the item's words.
async function partnerOffers(
  catalog: CatalogRepository,
  embedder: ItemEmbedder,
  item: LookItem,
  embedding: number[],
) {
  // Without the English noun (photos tagged before it existed) there are no words to rank by:
  // the name is in the user's language, and the text tower and kindOf only read English.
  if (!item.noun) return [];
  const pool = await catalog.offerCandidates({
    category: item.category,
    image: embedding,
    kind: kindOf(item.noun),
    byImage: POOL_BY_IMAGE,
    byKind: POOL_BY_KIND,
  });
  // Nothing to rank: don't load the text model for it.
  if (pool.length === 0) return [];
  // Offers are extras: the text model failing to download is no reason to fail the look (the
  // ranker can't score without it, so no offers then).
  const text = await embedder.embedText(offerText(item)).catch((error: unknown) => {
    console.log(
      JSON.stringify({ msg: "offers skipped", category: item.category, reason: String(error) }),
    );
    return null;
  });
  if (!text) return [];
  // Both are unit vectors, so the cosine is the dot product; 14 of them cost nothing here.
  const offers = rankOffers(
    item,
    pool.map((row) => ({
      ...row,
      name: row.names.en ?? "",
      textSimilarity: dot(row.embedding!, text),
    })),
  );
  return offers.map((offer) => offer.id);
}

type MatchDeps = Pick<
  PhotoJobDeps,
  "photos" | "storage" | "tagger" | "embedder" | "remover" | "catalog"
>;

// "Want / Can": for each item found on a look someone else wears, the wardrobe item that is the
// same or could stand in for it. Each item is cropped from the look, cut out of its background
// when a remover is configured (wardrobe embeddings are made from cut-outs too), embedded, and
// its closest wardrobe items of the same category are shown to the model with the crop. Partner
// pieces come with it, picked by the offer ranker (offer-ranker.ts) from the closest by image
// and by name: they are offers, not claims of a match.
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
      const query = cut ? await flattenOnWhite((await processCutout(cut)).webp) : crop;
      const embedding = await embedder.embedImage(query);
      const shop = catalog ? await partnerOffers(catalog, embedder, item, embedding) : [];
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
