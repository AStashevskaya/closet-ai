import type { AppLanguage } from "@closet-ai/shared";
import type { Stylist } from "../../ai/stylist";
import type { Storage } from "../../storage/storage";
import type { OutfitsRepository } from "./outfits.repository";
import { asJpeg, contactSheet, pickCandidates, seasonOf, toStylistPiece } from "./wardrobe-sheet";

export interface OutfitQueue {
  enqueueComposing(requestId: string, lang: AppLanguage): Promise<void>;
  // Checks whether the user's brief is stale and, if so, starts writing a new one.
  enqueueBrief(userId: string): Promise<void>;
  enqueueBriefCheck(userId: string, delayMs: number): Promise<void>;
}

export interface OutfitJobDeps {
  outfits: OutfitsRepository;
  storage: Storage;
  // null when no API key is configured: outfits are off.
  stylist: Stylist | null;
  queue: OutfitQueue;
  clock?: () => Date;
}

// A request that can never be composed (its item is gone): marked failed without retrying.
export class PermanentOutfitError extends Error {}

export const LOOKS_PER_REQUEST = 4;

// Job "compose": outfits around the request's item. Safe to run twice: only a pending request
// is composed.
export async function composeOutfits(deps: OutfitJobDeps, requestId: string, lang: AppLanguage) {
  const { outfits, storage, stylist } = deps;
  const request = await outfits.getRequest(requestId);
  if (!request || request.status !== "pending") return;
  if (!stylist) throw new PermanentOutfitError("no stylist configured");

  const wardrobe = await outfits.wardrobe(request.userId);
  const hero = wardrobe.find((item) => item.id === request.itemId);
  if (!hero) throw new PermanentOutfitError("the item is gone or has no ready photo");
  const heroFile = await storage.get(hero.imageKey);
  if (!heroFile) throw new PermanentOutfitError("the item's picture is missing from storage");

  // Numbers follow the wardrobe's order, so the list (the cached part) stays the same between requests.
  const numbered = wardrobe.map((item, i) => ({ item, n: i + 1 }));
  const nOf = new Map(numbered.map(({ item, n }) => [item.id, n]));
  const season = seasonOf(deps.clock?.() ?? new Date());
  const candidates = pickCandidates(hero, wardrobe, season);
  const sheet = await contactSheet(
    storage,
    candidates.map((item) => ({ n: nOf.get(item.id)!, imageKey: item.imageKey })),
  );

  const { looks, costMicros } = await stylist.compose({
    hero: { ...toStylistPiece(hero, nOf.get(hero.id)!), image: await asJpeg(heroFile.body, 512) },
    wardrobe: numbered
      .filter(({ item }) => item.id !== hero.id)
      .map(({ item, n }) => toStylistPiece(item, n)),
    sheet,
    brief: (await outfits.brief(request.userId))?.brief ?? null,
    season,
    lang,
    looks: LOOKS_PER_REQUEST,
  });

  // Only pieces that were on the sheet: a number the model made up, or the item itself, is dropped.
  const byN = new Map(candidates.map((item) => [nOf.get(item.id)!, item]));
  await outfits.saveOutfits(
    requestId,
    request.userId,
    looks.map((look) => ({
      caption: look.caption,
      occasion: look.occasion,
      why: look.why,
      missing: look.missing,
      pieces: [
        { hero: true, itemId: hero.id },
        ...[...new Set(look.items)].flatMap((n) => {
          const item = byN.get(n);
          return item ? [{ hero: false, itemId: item.id }] : [];
        }),
      ],
    })),
    costMicros,
  );
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
const BRIEF_INSPIRATION = 6;
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
  const stale =
    !current?.brief ||
    Math.abs(wardrobe.length - current.itemCount) >= STALE_AFTER_CHANGES ||
    reactions - current.reactionCount >= STALE_AFTER_CHANGES ||
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
  await outfits.saveBrief(
    userId,
    result.brief,
    await outfits.wardrobeSize(userId),
    await outfits.reactionCount(userId),
  );
}
