import type { AppLanguage } from "@closet-ai/shared";
import type { BackgroundRemover } from "../../ai/background-remover";
import type { ItemEmbedder } from "../../ai/item-embedder";
import type { Stylist } from "../../ai/stylist";
import type { Storage } from "../../storage/storage";
import type { CatalogRepository } from "../catalog/catalog.repository";
import { cutOutByName, cutoutKeyFor } from "../photos/photo-jobs";
import type { PhotosRepository } from "../photos/photos.repository";
import { flattenOnWhite, processCutout } from "../photos/process-photo";
import type { OutfitRequestRow, OutfitsRepository, StylingItem } from "./outfits.repository";
import {
  asJpeg,
  contactSheet,
  pickCandidates,
  pickShop,
  seasonOf,
  shopPiece,
  toStylistPiece,
} from "./wardrobe-sheet";

export interface OutfitQueue {
  enqueueComposing(requestId: string, lang: AppLanguage): Promise<void>;
  // Checks whether the user's brief is stale and, if so, starts writing a new one. A delay
  // lets a few saved looks in a row go into one brief.
  enqueueBrief(userId: string, delayMs?: number): Promise<void>;
  enqueueBriefCheck(userId: string, delayMs: number): Promise<void>;
}

export interface OutfitJobDeps {
  outfits: OutfitsRepository;
  photos: PhotosRepository;
  storage: Storage;
  // For an item from a photo: cuts it out (null: the crop is used as it is) and embeds it
  // (null: the contact sheet isn't ordered by closeness).
  remover: BackgroundRemover | null;
  embedder: ItemEmbedder | null;
  // null when no API key is configured: outfits are off.
  stylist: Stylist | null;
  // Partner items the stylist may finish a look with; null when they are switched off.
  catalog: CatalogRepository | null;
  queue: OutfitQueue;
  clock?: () => Date;
}

// A request that can never be composed (its item is gone): marked failed without retrying.
export class PermanentOutfitError extends Error {}

export const LOOKS_PER_REQUEST = 4;
// Partner pieces stay the exception: never in every look (docs/product.md, partner items).
export const MAX_PARTNER_LOOKS = 2;

// Job "compose": outfits around the request's item. Safe to run twice: only a pending request
// is composed.
export async function composeOutfits(deps: OutfitJobDeps, requestId: string, lang: AppLanguage) {
  const { outfits, storage, stylist } = deps;
  const request = await outfits.getRequest(requestId);
  if (!request || request.status !== "pending") return;
  if (!stylist) throw new PermanentOutfitError("no stylist configured");

  const wardrobe = await outfits.wardrobe(request.userId);
  const hero = request.heroPhotoKey
    ? await heroFromPhoto(deps, request)
    : wardrobe.find((item) => item.id === request.itemId);
  // A wardrobe item saved a moment ago may still have its photo processing ("save and style it"):
  // a plain error, so the queue tries again in a few seconds. Gone for good after the retries.
  if (!hero && request.itemId) throw new Error("the item's photo is not ready yet");
  if (!hero) throw new PermanentOutfitError("the item from the photo is gone");
  const heroFile = await storage.get(hero.imageKey);
  if (!heroFile) throw new PermanentOutfitError("the item's picture is missing from storage");

  // Numbers follow the wardrobe's order, so the list (the cached part) stays the same between
  // requests. An item from a photo isn't in the wardrobe: it gets the number after the last.
  const numbered = wardrobe.map((item, i) => ({ item, n: i + 1 }));
  const nOf = new Map(numbered.map(({ item, n }) => [item.id, n]));
  if (!nOf.has(hero.id)) nOf.set(hero.id, wardrobe.length + 1);
  const season = seasonOf(deps.clock?.() ?? new Date());
  const candidates = pickCandidates(hero, wardrobe, season);
  const sheet = await contactSheet(
    storage,
    candidates.map((item) => ({ n: nOf.get(item.id)!, imageKey: item.imageKey })),
  );

  // Numbered after the wardrobe and the item from a photo, so no number means two things.
  const shopRows = deps.catalog ? await pickShop(deps.catalog, hero) : [];
  const shopN = (i: number) => wardrobe.length + 2 + i;
  const shop =
    shopRows.length > 0
      ? {
          pieces: shopRows.map((row, i) => shopPiece(row, shopN(i))),
          sheet: await contactSheet(
            storage,
            shopRows.map((row, i) => ({ n: shopN(i), imageKey: row.imageKey })),
          ),
        }
      : null;

  const { looks, costMicros } = await stylist.compose({
    hero: { ...toStylistPiece(hero, nOf.get(hero.id)!), image: await asJpeg(heroFile.body, 512) },
    wardrobe: numbered
      .filter(({ item }) => item.id !== hero.id)
      .map(({ item, n }) => toStylistPiece(item, n)),
    sheet,
    brief: (await outfits.brief(request.userId))?.brief ?? null,
    shop,
    season,
    mood: request.mood,
    lang,
    looks: LOOKS_PER_REQUEST,
  });

  // Any piece of her wardrobe: the model sometimes takes a fitting one from the list that wasn't
  // on the sheet, and dropping it left a look without its skirt while "why" still spoke of it
  // (owner's halter top, 2026-10-22). A number the model made up, or the item itself, is dropped.
  const byN = new Map(
    numbered.filter(({ item }) => item.id !== hero.id).map(({ item, n }) => [n, item]),
  );
  const shopByN = new Map(shopRows.map((row, i) => [shopN(i), row]));
  const resolved = looks.map((look) => ({
    look,
    items: [...new Set(look.items)].flatMap((n) => byN.get(n) ?? []),
    shop: look.partner === null ? undefined : shopByN.get(look.partner),
  }));
  // A look without a bottom (or a dress) isn't one; shown only if every look came out so.
  const complete = resolved.filter(({ items, shop }) =>
    isComplete([hero.category, ...items.map((item) => item.category), shop?.category]),
  );
  let partnerLooks = 0;
  const saved = (complete.length > 0 ? complete : resolved).map(({ look, items, shop }) => {
    const partner = shop && partnerLooks < MAX_PARTNER_LOOKS ? shop : undefined;
    if (partner) partnerLooks += 1;
    return {
      caption: look.caption,
      occasion: look.occasion,
      why: look.why,
      // The shop piece fills that slot already.
      missing: partner && look.missing?.category === partner.category ? null : look.missing,
      pieces: [
        { hero: true, itemId: request.heroPhotoKey ? null : hero.id },
        ...items.map((item) => ({ hero: false, itemId: item.id })),
        ...(partner
          ? [{ hero: false, itemId: null, catalogItemId: partner.id, sponsored: true }]
          : []),
      ],
    };
  });
  await outfits.saveOutfits(requestId, request.userId, saved, costMicros);

  const shown = saved.flatMap((look) => look.pieces.flatMap((p) => p.catalogItemId ?? []));
  await deps.catalog?.record(shown, request.userId, "shown");
}

// Something to wear: a dress, or a top and a bottom.
export function isComplete(categories: (string | undefined)[]) {
  return (
    categories.includes("dress") || (categories.includes("top") && categories.includes("bottom"))
  );
}

// The item from a photo, as styling sees it: cut out by its English name the first time (the
// crop stays when the model finds nothing or fal is down), and embedded so the contact sheet
// is ordered by closeness to it.
async function heroFromPhoto(
  { photos, storage, remover, embedder }: OutfitJobDeps,
  request: OutfitRequestRow,
): Promise<StylingItem | undefined> {
  const photo = await photos.get(request.heroPhotoKey!);
  const crop = photo ? await storage.get(photo.key) : null;
  if (!photo?.tags || !crop) return undefined;

  let cutoutKey = photo.cutoutKey;
  if (!cutoutKey && remover) {
    const png = await cutOutByName(
      remover,
      crop.body,
      { category: photo.tags.category, noun: request.heroNoun ?? photo.tags.noun },
      { fromLook: true },
    ).catch(() => null);
    if (png) {
      cutoutKey = cutoutKeyFor(photo.key);
      await storage.put(cutoutKey, await processCutout(png), "image/webp");
      await photos.setCutout(photo.key, cutoutKey);
    }
  }
  const image = cutoutKey ? await storage.get(cutoutKey) : crop;
  const embedding =
    embedder && image
      ? await embedder.embedImage(cutoutKey ? await flattenOnWhite(image.body) : image.body)
      : null;
  return {
    // Not a wardrobe item; the request's id keeps it apart from them.
    id: request.id,
    name: photo.tags.name,
    category: photo.tags.category,
    colors: photo.tags.colors,
    seasons: photo.tags.seasons,
    tags: photo.tags,
    imageKey: cutoutKey ?? photo.key,
    embedding,
  };
}

// A brief needs something to read; below this the stylist works from the wardrobe directly.
export const MIN_ITEMS_FOR_BRIEF = 8;
// Rewritten after this many new items or reactions, or after a month.
const STALE_AFTER_CHANGES = 5;
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
// Batches usually end in minutes; one that runs for a day is given up on.
const BATCH_GIVE_UP_MS = 24 * 60 * 60 * 1000;
export const BRIEF_CHECK_EVERY_MS = 2 * 60 * 1000;
// Kept small: images are the expensive part of the brief's prompt.
const BRIEF_SHEET_ITEMS = 48;
// The newest saved looks: they say most about where her taste is going.
const BRIEF_INSPIRATION = 12;
// A few new saved looks are enough to rewrite it: they are the strongest signal of taste.
const STALE_AFTER_INSPIRATIONS = 3;
const BRIEF_REACTED = 20;

// Job "brief": starts a new brief through the Batch API when there is none or it's stale.
export async function refreshBrief(deps: OutfitJobDeps, userId: string) {
  const { outfits, storage, stylist, queue } = deps;
  if (!stylist) return;
  const now = deps.clock?.() ?? new Date();
  const current = await outfits.brief(userId);
  if (
    current?.batchId &&
    current.requestedAt &&
    now.getTime() - current.requestedAt.getTime() < BATCH_GIVE_UP_MS
  ) {
    return;
  }

  const wardrobe = await outfits.wardrobe(userId);
  if (wardrobe.length < MIN_ITEMS_FOR_BRIEF) return;
  const reactions = await outfits.reactionCount(userId);
  const saved = (await deps.photos.listInspiration(userId)).length;
  const stale =
    !current?.brief ||
    Math.abs(wardrobe.length - current.itemCount) >= STALE_AFTER_CHANGES ||
    reactions - current.reactionCount >= STALE_AFTER_CHANGES ||
    Math.abs(saved - current.inspirationCount) >= STALE_AFTER_INSPIRATIONS ||
    !current.writtenAt ||
    now.getTime() - current.writtenAt.getTime() > STALE_AFTER_MS;
  if (!stale) return;

  // The newest pieces when the wardrobe is big: they say most about her taste now.
  const numbered = wardrobe.map((item, i) => ({ item, n: i + 1 }));
  const shown = numbered.slice(-BRIEF_SHEET_ITEMS * 2);
  const sheets = [];
  for (let i = 0; i < shown.length; i += BRIEF_SHEET_ITEMS) {
    sheets.push(
      await contactSheet(
        storage,
        shown
          .slice(i, i + BRIEF_SHEET_ITEMS)
          .map(({ item, n }) => ({ n, imageKey: item.imageKey })),
      ),
    );
  }
  const inspiration = [];
  for (const key of await outfits.inspirationKeys(userId, BRIEF_INSPIRATION)) {
    const file = await storage.get(key);
    if (file) inspiration.push(await asJpeg(file.body, 800));
  }
  const reacted = await outfits.reactedOutfits(userId, BRIEF_REACTED);

  const batchId = await stylist.submitBrief({
    wardrobe: numbered.map(({ item, n }) => toStylistPiece(item, n)),
    sheets,
    inspiration,
    liked: reacted.filter((o) => o.opinion === "like" || o.wore).map((o) => o.description),
    disliked: reacted.filter((o) => o.opinion === "dislike").map((o) => o.description),
  });
  await outfits.setBriefBatch(userId, batchId);
  await queue.enqueueBriefCheck(userId, BRIEF_CHECK_EVERY_MS);
}

// Job "brief-check": stores the brief once its batch has ended, or looks again later.
export async function checkBrief(deps: OutfitJobDeps, userId: string) {
  const { outfits, stylist, queue } = deps;
  const current = await outfits.brief(userId);
  if (!stylist || !current?.batchId) return;
  const now = deps.clock?.() ?? new Date();

  const result = await stylist.briefResult(current.batchId);
  if (result.status === "pending") {
    const age = current.requestedAt ? now.getTime() - current.requestedAt.getTime() : 0;
    if (age < BATCH_GIVE_UP_MS) await queue.enqueueBriefCheck(userId, BRIEF_CHECK_EVERY_MS);
    else await outfits.setBriefBatch(userId, null);
    return;
  }
  if (result.status === "failed") {
    await outfits.setBriefBatch(userId, null);
    return;
  }
  await outfits.saveBrief(userId, result.brief, {
    itemCount: await outfits.wardrobeSize(userId),
    reactionCount: await outfits.reactionCount(userId),
    inspirationCount: (await deps.photos.listInspiration(userId)).length,
  });
}
