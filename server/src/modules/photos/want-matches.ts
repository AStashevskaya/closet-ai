import type { LookItem, LookMatch } from "@closet-ai/shared";
import { TaggingRefusedError } from "../../ai/item-tagger";
import type { PhotoJobDeps } from "./photo-jobs";
import { cropToBox, flattenOnWhite, processCutout, thumbnail } from "./process-photo";

// Wardrobe items the model compares each look item with: the closest by embedding. The
// embedding alone can't tell a match from a near miss (an olive jacket scored closer to a pink
// shirt than a real match did), so the model has the last word.
export const MATCH_CANDIDATES = 3;

const NO_MATCH: LookMatch = { how: "none", itemId: null };

type MatchDeps = Pick<PhotoJobDeps, "photos" | "storage" | "tagger" | "embedder" | "remover">;

// "Want / Can": for each item found on a look someone else wears, the wardrobe item that is the
// same or could stand in for it. Each item is cropped from the look, cut out of its background
// when a remover is configured (wardrobe embeddings are made from cut-outs too), embedded, and
// its closest wardrobe items of the same category are shown to the model with the crop.
export async function matchLookItems(
  { photos, storage, tagger, embedder, remover }: MatchDeps,
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
      const cut = remover ? await remover.removeBackground(crop).catch(() => null) : null;
      const query = cut ? await flattenOnWhite(await processCutout(cut)) : crop;
      const closest = await photos.closestItems(
        ownerId,
        item.category,
        await embedder.embedImage(query),
        MATCH_CANDIDATES,
      );
      if (closest.length === 0) return NO_MATCH;

      const candidates = await Promise.all(
        closest.map(async ({ name, photoKey, cutoutKey }) => {
          const file = await storage.get(cutoutKey ?? photoKey);
          return file ? { name, image: await thumbnail(file.body) } : null;
        }),
      );
      const shown = closest.filter((_, index) => candidates[index]);
      if (shown.length === 0) return NO_MATCH;

      try {
        const verdict = await tagger.compare(
          await thumbnail(crop),
          candidates.filter((candidate) => candidate !== null),
        );
        return verdict.index === null
          ? NO_MATCH
          : { how: verdict.how, itemId: shown[verdict.index]!.itemId };
      } catch (error) {
        // A declined comparison is one item without an answer, not a failed look.
        if (error instanceof TaggingRefusedError) return NO_MATCH;
        throw error;
      }
    }),
  );
}
