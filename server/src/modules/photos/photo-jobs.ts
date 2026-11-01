import { randomBytes } from "node:crypto";
import type { AppLanguage, ItemTags } from "@closet-ai/shared";
import type { BackgroundRemover } from "../../ai/background-remover";
import type { ItemEmbedder } from "../../ai/item-embedder";
import { TaggingRefusedError, type ItemTagger } from "../../ai/item-tagger";
import type { PhotoQueue } from "../../queue/photo-queue";
import type { Storage } from "../../storage/storage";
import type { CatalogRepository } from "../catalog/catalog.repository";
import {
  flattenOnWhite,
  processCutout,
  processPhoto,
  UnsupportedPhotoError,
} from "./process-photo";
import type { PhotosRepository } from "./photos.repository";
import { matchLookItems } from "./want-matches";

export interface PhotoJobDeps {
  photos: PhotosRepository;
  storage: Storage;
  // null when no API key is configured: photos are processed but not tagged.
  tagger: ItemTagger | null;
  // null where the model isn't loaded (tests that don't need it).
  embedder: ItemEmbedder | null;
  // null when no fal.ai key is configured: photos keep their background.
  remover: BackgroundRemover | null;
  // Partner items to offer for a "want" look's items; absent or null when switched off.
  catalog?: CatalogRepository | null;
  queue: Pick<PhotoQueue, "enqueueTagging" | "enqueueEmbedding" | "enqueueCutout">;
}

// The cut-out sits next to the photo: photos/<owner id>/<uuid>-cutout.webp
export const cutoutKeyFor = (photoKey: string) => photoKey.replace(/\.webp$/, "-cutout.webp");
// A redone cut-out gets a key (and so a URL) of its own, or phones keep the cached old one.
const redoneCutoutKey = (photoKey: string) =>
  photoKey.replace(/\.webp$/, `-cutout-${randomBytes(3).toString("hex")}.webp`);

// A photo that can never be processed (not an image after all, original gone).
// The worker marks it failed straight away instead of retrying.
export class PermanentPhotoError extends Error {}

// Job "process": turns the uploaded original into the stored WebP. Safe to run twice:
// a photo that is no longer "processing" is left alone.
export async function processUploadedPhoto(
  { photos, storage, queue, embedder, remover }: PhotoJobDeps,
  key: string,
  lang: AppLanguage,
) {
  const photo = await photos.get(key);
  if (!photo || photo.status !== "processing") return;
  if (!photo.uploadKey) throw new PermanentPhotoError("no original to process");

  const original = await storage.get(photo.uploadKey);
  if (!original) throw new PermanentPhotoError("original is missing from storage");

  let webp: Uint8Array;
  try {
    webp = await processPhoto(original.body);
  } catch (error) {
    if (error instanceof UnsupportedPhotoError) throw new PermanentPhotoError(error.message);
    throw error;
  }

  await storage.put(photo.key, webp, "image/webp");
  await photos.markReady(photo.key);
  await storage.delete(photo.uploadKey);
  // Tagging is its own job with its own retries: a slow or failing model never holds up the photo.
  // It reads the small WebP, which is also what keeps the model call cheap.
  // The tagger reads the whole photo: the background doesn't confuse it, and it shouldn't wait.
  if (photo.tagStatus === "pending") await queue.enqueueTagging(photo.key, lang);
  // A look is only read for its items: the items picked from it get their own photos.
  if (photo.kind !== "item") return;
  // The cut-out waits for the tags: an item someone is wearing isn't cut out (see tagPhoto).
  // Untagged photos (tagging off) go straight on.
  if (photo.tagStatus !== "pending")
    await queueAfterTagging({ queue, embedder, remover }, photo.key);
}

// What comes after an item photo is tagged (or tagging gave up): the cut-out, then the
// embedding, which is better made from the cut-out, so with a remover it waits for it.
export async function queueAfterTagging(
  { queue, embedder, remover }: Pick<PhotoJobDeps, "queue" | "embedder" | "remover">,
  key: string,
  { onPerson = false } = {},
) {
  // Cut out of a selfie, a worn item loses the head and arms around it and looks odd;
  // it keeps its photo instead (making it look nice is Premium).
  if (remover && !onPerson) await queue.enqueueCutout(key);
  else if (embedder) await queue.enqueueEmbedding(key);
}

// Clothes cut out well asked for as "garment"; shoes and bags need a name.
const isClothing = (category: string) => category !== "shoes" && category !== "accessory";
const FALLBACK_NOUNS: Record<string, string> = { shoes: "shoes", accessory: "bag" };

// Asks for the item a few ways until one finds it: "garment" first for clothes, then its English
// type ("sequin mini skirt"), then the type's last word ("skirt"). Each try is a fal call
// (~$0.005), and most photos stop at the first. Shoes come back as a pair. A crop from a look
// (fromLook) asks by type first: "garment" there may find the shirt over the skirt; a piece found
// by type is then checked against "garment" for a trim the type left out (one more call).
export async function cutOutByName(
  remover: BackgroundRemover,
  image: Uint8Array,
  tags: Pick<ItemTags, "category" | "noun"> | null,
  { fromLook = false } = {},
): Promise<Uint8Array | null> {
  const clothing = !tags || isClothing(tags.category);
  const noun = tags?.noun?.trim() || null;
  // undefined asks for the remover's default, "garment".
  const names: (string | undefined)[] = clothing && !fromLook ? [undefined] : [];
  if (noun) names.push(noun, noun.split(/\s+/).at(-1));
  if (clothing && fromLook) names.push(undefined);
  if (tags && !clothing) names.push(FALLBACK_NOUNS[tags.category]);
  for (const name of new Set(names)) {
    const png = await remover.removeBackground(image, name, {
      pair: tags?.category === "shoes",
      ...(clothing && fromLook && name ? { trim: true } : {}),
    });
    if (png) return png;
  }
  return null;
}

// Job "cutout": cuts the item out of its background, then queues the embedding, which is made
// from the cut-out. Running it twice makes the same cut-out again.
export async function cutOutPhoto(
  { photos, storage, remover, embedder, queue, tagger }: PhotoJobDeps,
  key: string,
) {
  if (!remover) return;
  const photo = await photos.get(key);
  if (!photo || photo.status !== "ready") return;

  const file = await storage.get(photo.key);
  if (!file) throw new PermanentPhotoError("processed photo is missing from storage");

  // Shoes and bags have to be asked for by name ("garment" finds nothing on them), and a
  // garment it misses may still be found by its type. A photo tagged before tags had a noun is
  // tagged again for it (a fraction of a cent).
  let tags = photo.tags;
  if (tagger && !tags?.noun) {
    try {
      const { onPerson: _onPerson, ...fresh } = await tagger.tag(file.body, "en");
      // The name stays in the user's language: only the noun (and a category if there was none) is taken.
      tags = tags ? { ...tags, noun: fresh.noun } : fresh;
      await photos.setTags(photo.key, tags);
    } catch {
      // Cut out as before, as a garment.
    }
  }
  const png = await cutOutByName(remover, file.body, tags);
  // No item found (or an empty mask): the photo keeps its background, and is embedded as it is.
  const cutout = png ? await processCutout(png) : null;
  if (cutout) {
    const cutoutKey = photo.cutoutKey ? redoneCutoutKey(photo.key) : cutoutKeyFor(photo.key);
    await storage.put(cutoutKey, cutout.webp, "image/webp");
    await photos.setCutout(photo.key, cutoutKey, cutout.box);
    if (photo.cutoutKey) await storage.delete(photo.cutoutKey);
  }
  if (embedder) await queue.enqueueEmbedding(photo.key);
}

// Job "embed": computes the photo's embedding for "find similar", from the cut-out when there
// is one, so the bed or floor under the item doesn't count. Running it twice just computes the
// same vector again.
export async function embedPhoto({ photos, storage, embedder }: PhotoJobDeps, key: string) {
  if (!embedder) return;
  const photo = await photos.get(key);
  if (!photo || photo.status !== "ready") return;

  if (photo.cutoutKey) {
    const cutout = await storage.get(photo.cutoutKey);
    if (!cutout) throw new PermanentPhotoError("cut-out is missing from storage");
    await photos.setEmbedding(
      photo.key,
      await embedder.embedImage(await flattenOnWhite(cutout.body)),
    );
    return;
  }
  const file = await storage.get(photo.key);
  if (!file) throw new PermanentPhotoError("processed photo is missing from storage");
  await photos.setEmbedding(photo.key, await embedder.embedImage(file.body));
}

// Job "tag": asks the vision model what the item is, then queues the cut-out; for a look
// photo, which items it shows, and for a "want" look, which of them the wardrobe has.
// Safe to run twice: only a ready photo still waiting for tags is tagged.
export async function tagPhoto(deps: PhotoJobDeps, key: string, lang: AppLanguage) {
  const { photos, storage, tagger } = deps;
  const photo = await photos.get(key);
  if (!photo || photo.status !== "ready" || photo.tagStatus !== "pending") return;
  if (!tagger) throw new PermanentPhotoError("tagging is not configured");

  const file = await storage.get(photo.key);
  if (!file) throw new PermanentPhotoError("processed photo is missing from storage");

  try {
    // A selfie, or a photo of an item to style: its items, with boxes, for the user to pick.
    if (photo.kind === "look" || photo.kind === "wear") {
      // A "wear" photo shows a piece she may buy, often on a shop shelf, not on anyone.
      const scene = photo.kind === "wear" ? "shown" : "worn";
      await photos.setLookItems(photo.key, await tagger.findItems(file.body, lang, scene));
      return;
    }
    if (photo.kind === "want") {
      const items = await tagger.findItems(file.body, lang, "worn");
      const matches = await matchLookItems(deps, photo.ownerId, file.body, items);
      await photos.setLookItems(photo.key, items, matches);
      const shown = matches.flatMap((match) => match.shop ?? []);
      await deps.catalog?.record(shown, photo.ownerId, "shown");
      return;
    }
    const { onPerson, ...tags } = await tagger.tag(file.body, lang);
    await photos.setTags(photo.key, tags);
    await queueAfterTagging(deps, photo.key, { onPerson });
  } catch (error) {
    if (error instanceof TaggingRefusedError) throw new PermanentPhotoError(error.message);
    throw error;
  }
}

// Removes a photo for good: the processed file, the cut-out and the original if they are there,
// then the row.
// The row goes last, so if storage fails the photo stays unattached and the cleanup job retries.
// Deleting needs only the photos table and storage, so the API can call it too.
type StorageDeps = Pick<PhotoJobDeps, "photos" | "storage">;

export async function deletePhoto({ photos, storage }: StorageDeps, key: string) {
  const photo = await photos.get(key);
  if (!photo) return;
  await storage.delete(photo.key);
  if (photo.cutoutKey) await storage.delete(photo.cutoutKey);
  if (photo.uploadKey) await storage.delete(photo.uploadKey);
  await photos.delete(photo.key);
}

// A day is plenty to finish the add-item form.
export const UNATTACHED_PHOTO_TTL_MS = 24 * 60 * 60 * 1000;

// Job "cleanup": deletes photos that were uploaded but never attached to an item
// (the user picked a photo and left the form), and photos of deleted items.
export async function deleteUnattachedPhotos(deps: StorageDeps, now = new Date()) {
  const stale = await deps.photos.listUnattached(new Date(now.getTime() - UNATTACHED_PHOTO_TTL_MS));
  for (const photo of stale) await deletePhoto(deps, photo.key);
  return stale.length;
}
