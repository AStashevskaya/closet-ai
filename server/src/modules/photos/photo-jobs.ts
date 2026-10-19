import type { AppLanguage } from "@closet-ai/shared";
import { TaggingRefusedError, type ItemTagger } from "../../ai/item-tagger";
import type { PhotoQueue } from "../../queue/photo-queue";
import type { Storage } from "../../storage/storage";
import { processPhoto, UnsupportedPhotoError } from "./process-photo";
import type { PhotosRepository } from "./photos.repository";

export interface PhotoJobDeps {
  photos: PhotosRepository;
  storage: Storage;
  // null when no API key is configured: photos are processed but not tagged.
  tagger: ItemTagger | null;
  queue: Pick<PhotoQueue, "enqueueTagging">;
}

// A photo that can never be processed (not an image after all, original gone).
// The worker marks it failed straight away instead of retrying.
export class PermanentPhotoError extends Error {}

// Job "process": turns the uploaded original into the stored WebP. Safe to run twice:
// a photo that is no longer "processing" is left alone.
export async function processUploadedPhoto(
  { photos, storage, queue }: PhotoJobDeps,
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
  if (photo.tagStatus === "pending") await queue.enqueueTagging(photo.key, lang);
}

// Job "tag": asks the vision model what the item is. Safe to run twice: only a ready photo
// still waiting for tags is tagged.
export async function tagPhoto(
  { photos, storage, tagger }: PhotoJobDeps,
  key: string,
  lang: AppLanguage,
) {
  const photo = await photos.get(key);
  if (!photo || photo.status !== "ready" || photo.tagStatus !== "pending") return;
  if (!tagger) throw new PermanentPhotoError("tagging is not configured");

  const file = await storage.get(photo.key);
  if (!file) throw new PermanentPhotoError("processed photo is missing from storage");

  try {
    await photos.setTags(photo.key, await tagger.tag(file.body, lang));
  } catch (error) {
    if (error instanceof TaggingRefusedError) throw new PermanentPhotoError(error.message);
    throw error;
  }
}

// Removes a photo for good: the processed file, the original if it is still there, then the row.
// The row goes last, so if storage fails the photo stays unattached and the cleanup job retries.
// Deleting needs only the photos table and storage, so the API can call it too.
type StorageDeps = Pick<PhotoJobDeps, "photos" | "storage">;

export async function deletePhoto({ photos, storage }: StorageDeps, key: string) {
  const photo = await photos.get(key);
  if (!photo) return;
  await storage.delete(photo.key);
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
