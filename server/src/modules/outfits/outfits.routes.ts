import type { FastifyBaseLogger } from "fastify";
import { createHash } from "node:crypto";
import {
  APP_LANGUAGES,
  incompleteMessage,
  isWholeLook,
  missingForLook,
  outfitReactionInput,
  pieceStrikeInput,
  styledList,
  wearWithInput,
  wearWithRequest,
  wearWithStarted,
  type Item,
  type ItemCategory,
  type StyledEntry,
  type StyledPreview,
  type WearWithRequest,
} from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import type { ItemsRepository } from "../items/items.repository";
import { deletePhoto } from "../photos/photo-jobs";
import type { PhotosRepository } from "../photos/photos.repository";
import { photoPrefix } from "../photos/photos.routes";
import { cropToBox } from "../photos/process-photo";
import type { Limits } from "../usage/limits";
import type { WishesRepository } from "../wishes/wishes.repository";
import type { OutfitQueue } from "./outfit-jobs";
import type { OutfitsRepository } from "./outfits.repository";

// Styled items listed at most, newest first.
const HISTORY_LIMIT = 30;
// A request still pending after this long has been lost; the app has long stopped waiting for it.
const COMPOSING_FOR_MS = 5 * 60 * 1000;

// The photo of an item from a photo, served by the API like an item's: by request id.
export const heroPath = (requestId: string, variant?: "cutout") =>
  `/api/wear-with/${requestId}/photo${variant ? `?variant=${variant}` : ""}`;

// Only whole looks are shown: one with a bottom (or a dress) and a top. Looks saved before that
// rule (owner, 2026-11-11) may lack one; they stay in the database for the brief, unseen. The
// piece's kind comes from its hero piece, or for a piece from a photo from the photo's tags;
// when neither is known the look is kept.
function wholeOnly<T extends WearWithRequest | null>(request: T, heroCategory?: ItemCategory): T {
  if (!request) return request;
  return {
    ...request,
    outfits: request.outfits.filter((look) => {
      const hero = heroCategory ?? look.pieces.find((piece) => piece.hero)?.item?.category;
      if (!hero) return true;
      return isWholeLook(
        hero,
        look.pieces.flatMap((piece) => {
          const category = piece.item?.category ?? piece.catalogItem?.category;
          return !piece.hero && category ? [category] : [];
        }),
      );
    }),
  };
}

// The diary's folded looks: wardrobe pieces only, so the language of partner names doesn't matter.
const PREVIEW_LOOKS = 3;
const PREVIEW_PIECES = 3;
function previewsOf(request: WearWithRequest | null): StyledPreview[] {
  return (request?.outfits ?? [])
    .filter((look) => look.opinion !== "dislike")
    .slice(0, PREVIEW_LOOKS)
    .map((look) => ({
      id: look.id,
      liked: look.opinion === "like",
      pieces: look.pieces
        .flatMap((piece) => (!piece.hero && piece.item ? [piece.item] : []))
        .slice(0, PREVIEW_PIECES)
        .map((item) => ({
          id: item.id,
          photoUrl: item.photoUrl ?? null,
          cutoutUrl: item.cutoutUrl ?? null,
        })),
    }));
}

// Deletes her styling (see OutfitsRepository.deleteRequest) and, when nothing else uses it, its
// piece's photo at once; false when it isn't hers or is already gone. A styling whose piece is in
// her wishes is only hidden and keeps its photo; letting the wish go calls this again.
export async function deleteStyling(
  deps: {
    outfits: OutfitsRepository;
    photos: PhotosRepository;
    storage: Storage;
    log: FastifyBaseLogger;
  },
  requestId: string,
  userId: string,
): Promise<boolean> {
  const { outfits, photos, storage, log } = deps;
  // Read first: the delete clears it.
  const key = (await outfits.getRequest(requestId))?.heroPhotoKey;
  if (!(await outfits.deleteRequest(requestId, userId))) return false;
  if (key) {
    try {
      // Other requests about the same piece share this crop (a hidden one too), and it may be in
      // her closet.
      const inUse = (await outfits.isAttached(key)) || (await photos.isHeroOfRequest(key));
      if (!inUse) await deletePhoto({ photos, storage }, key);
    } catch (error) {
      // The styling is already gone, so she still gets 204. No request points to the photo now,
      // so the hourly cleanup job tries again.
      log.warn({ err: error, key }, "failed to delete a styling's photo");
    }
  }
  return true;
}

export const outfitsRoutes =
  (
    outfits: OutfitsRepository,
    items: ItemsRepository,
    wishes: WishesRepository,
    photos: PhotosRepository,
    storage: Storage,
    queue: OutfitQueue,
    limits: Limits,
    auth: Auth,
    // false when no API key is configured: there is no stylist to ask.
    enabled: boolean,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    // Looks made earlier still hold while neither the wardrobe nor her taste (the brief) has changed.
    const stillHolds = async (
      userId: string,
      request: { wardrobeSize: number; createdAt: Date },
      size: number,
    ) => {
      const writtenAt = (await outfits.brief(userId))?.writtenAt;
      return request.wardrobeSize === size && (!writtenAt || request.createdAt > writtenAt);
    };

    app.addHook("preHandler", requireUser(auth));

    // "What do I wear this with?" for a wardrobe item, or for one item found on an uploaded
    // "wear" photo. Answers 202 with a request to poll; for a wardrobe item, 200 with the last
    // request while the wardrobe hasn't changed size: asking again shows the same outfits for free.
    app.post(
      "/wear-with",
      {
        schema: {
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          body: wearWithInput,
          response: { 200: wearWithStarted, 202: wearWithStarted },
        },
      },
      async (request, reply) => {
        if (!enabled) throw httpError(503, "outfits are off");
        const user = request.user as SessionUser;
        const size = await outfits.wardrobeSize(user.id);
        const mood = request.body.mood ?? null;
        let hero: Parameters<OutfitsRepository["createRequest"]>[1];
        // A look needs a bottom (or a dress) and a top: when the closet can't give the piece one,
        // she's told what to add before anything is paid for or counted (owner, 2026-11-11: looks
        // without trousers were shown).
        const lacking = async (category: ItemCategory, exceptId?: string) => {
          const closet = (await items.list(user.id))
            .filter((item) => item.id !== exceptId)
            .map((item) => item.category);
          const missing = missingForLook(category, closet);
          if (missing.length > 0) throw httpError(422, incompleteMessage(missing));
        };
        // Still at work, as when the phone gave up waiting for the answer and asks again: the same
        // request, not a second one counted against her day.
        const atWork = (asked: { status: string; createdAt: Date } | null) =>
          asked?.status === "pending" && Date.now() - asked.createdAt.getTime() < COMPOSING_FOR_MS;

        if ("itemId" in request.body) {
          const { itemId } = request.body;
          const item = await items.get(user.id, itemId);
          if (!item) throw httpError(404, "item not found");
          const asked = await outfits.latestAsked(user.id, { itemId }, mood);
          if (asked && atWork(asked)) return reply.code(200).send({ id: asked.id });
          const last = await outfits.latestDone(user.id, itemId, mood);
          // Only while it holds a whole look: one saved before that rule may not.
          if (
            last &&
            (await stillHolds(user.id, last, size)) &&
            wholeOnly(await outfits.view(last.id, user.id, "en"))?.outfits.length
          ) {
            return reply.code(200).send({ id: last.id });
          }
          await lacking(item.category, itemId);
          await limits.check(user.id, "wear_with");
          hero = { itemId };
        } else {
          // The picked item is cropped into a photo of its own; the job cuts it out.
          const { photoKey, index } = request.body;
          const photo = await photos.get(photoKey);
          if (!photo || photo.ownerId !== user.id || photo.kind !== "wear") {
            throw httpError(404, "photo not found");
          }
          const found = photo.lookItems?.[index];
          if (!photo.lookItems) throw httpError(409, "the photo's items are not found yet");
          if (!found) throw httpError(400, "no such item on the photo");
          // Named from the photo and the piece, so asking again finds the request made for it.
          const piece = createHash("sha256").update(`${photo.key}#${index}`).digest("hex");
          const key = `${photoPrefix(user.id)}${piece}.webp`;
          const asked = await outfits.latestAsked(user.id, { heroPhotoKey: key }, mood);
          if (
            asked &&
            (atWork(asked) || (asked.status === "done" && (await stillHolds(user.id, asked, size))))
          ) {
            return reply.code(200).send({ id: asked.id });
          }
          const file = await storage.get(photo.key);
          if (!file) throw httpError(409, "the photo is not ready");
          await lacking(found.category);
          await limits.check(user.id, "wear_with");

          await storage.put(key, await cropToBox(file.body, found.box), "image/webp");
          const { box: _box, ...tags } = found;
          await photos.createReady({ key, ownerId: user.id, tags: { ...tags, recognized: true } });
          hero = { heroPhotoKey: key, heroNoun: found.noun };
        }

        const id = await outfits.createRequest(user.id, hero, size, mood);
        await queue.enqueueComposing(id, request.query.lang);
        await limits.record(user.id, "wear_with");
        // The first brief is written in the background once it's due; the job decides.
        await queue.enqueueBrief(user.id);
        return reply.code(202).send({ id });
      },
    );

    // The styled items, newest first; an item deleted since (and not from a photo) drops out.
    app.get(
      "/wear-with",
      { schema: { response: { 200: styledList } } },
      async (request): Promise<StyledEntry[]> => {
        const user = request.user as SessionUser;
        const rows = await outfits.history(user.id, HISTORY_LIMIT);
        // Read once for the whole list rather than once per piece.
        const askAt = new Map((await wishes.list(user.id)).map((w) => [w.requestId, w.askAt]));
        const attached = await outfits.attachedKeys(
          rows.flatMap((row) => (row.heroPhotoKey ? [row.heroPhotoKey] : [])),
        );
        const entries = await Promise.all(
          rows.map(async (row): Promise<StyledEntry | null> => {
            const base = {
              id: row.id,
              createdAt: row.createdAt.toISOString(),
              mood: row.mood,
              previews: previewsOf(wholeOnly(await outfits.view(row.id, user.id, "en"))),
            };
            if (row.itemId) {
              const item = await items.get(user.id, row.itemId);
              if (!item) return null;
              return {
                ...base,
                name: item.name,
                photoUrl: item.photoUrl ?? null,
                cutoutUrl: item.cutoutUrl ?? null,
                loose: false,
                wishAskAt: null,
              };
            }
            const photo = row.heroPhotoKey ? await photos.get(row.heroPhotoKey) : null;
            if (!photo?.tags) return null;
            // Bought since (added from this photo): hers, and its wish is gone with it.
            const loose = !attached.has(photo.key);
            return {
              ...base,
              name: photo.tags.name,
              photoUrl: heroPath(row.id),
              cutoutUrl: photo.cutoutKey ? heroPath(row.id, "cutout") : null,
              loose,
              wishAskAt: loose ? (askAt.get(row.id)?.toISOString() ?? null) : null,
            };
          }),
        );
        return entries.filter((entry) => entry !== null);
      },
    );

    app.get(
      "/wear-with/:id",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          response: { 200: wearWithRequest },
        },
      },
      async (request): Promise<WearWithRequest> => {
        const user = request.user as SessionUser;
        const viewed = await outfits.view(request.params.id, user.id, request.query.lang);
        const row = await outfits.getRequest(request.params.id);
        const photoTags = row?.heroPhotoKey ? (await photos.get(row.heroPhotoKey))?.tags : null;
        const found = wholeOnly(viewed, photoTags?.category);
        if (!found || !row) throw httpError(404, "request not found");
        // Done, with neither piece: deleted, or about an item deleted since. Only its reacted looks
        // are left, for the brief. (A pending one whose item went is about to be marked failed.)
        if (row.status === "done" && !row.itemId && !row.heroPhotoKey) {
          throw httpError(404, "request not found");
        }
        if (!row.heroPhotoKey) return found;

        // An item from a photo: shown from its own photo, and addable to the wardrobe unless it
        // already is (adding attaches the photo to the new item).
        const photo = await photos.get(row.heroPhotoKey);
        if (!photo?.tags) return found;
        const { recognized: _recognized, ...tags } = photo.tags;
        const hero: Item = {
          id: row.id,
          name: tags.name,
          category: tags.category,
          colors: tags.colors.length > 0 ? tags.colors : ["multicolor"],
          seasons: tags.seasons,
          photoUrl: heroPath(row.id),
          cutoutUrl: photo.cutoutKey ? heroPath(row.id, "cutout") : undefined,
          photoStatus: "ready",
          createdAt: new Date().toISOString(),
        };
        const owned = await outfits.isAttached(row.heroPhotoKey);
        // The piece it nearly repeats; deleted since, it's just left out.
        const twinDetail = row.verdict?.twinItemId
          ? await items.get(user.id, row.verdict.twinItemId)
          : null;
        let twin: Item | null = null;
        if (twinDetail) {
          const { tags: _twinTags, ...rest } = twinDetail;
          twin = rest;
        }
        return {
          ...found,
          verdict: row.verdict && { call: row.verdict.call, reason: row.verdict.reason, twin },
          wishId: await wishes.idFor(user.id, row.id),
          addable: owned
            ? null
            : {
                name: hero.name,
                category: hero.category,
                colors: hero.colors.slice(0, 5),
                seasons: hero.seasons,
                photoKey: row.heroPhotoKey,
              },
          outfits: found.outfits.map((outfit) => ({
            ...outfit,
            pieces: outfit.pieces.map((piece) => (piece.hero ? { ...piece, item: hero } : piece)),
          })),
        };
      },
    );

    // Deleting a styling never gives a try back: limits count usage_events, which it doesn't touch.
    // A closet piece stays; so do the looks she reacted to, for the brief (see deleteRequest). A
    // piece from a photo goes with it, photo and cut-out at once, unless she added it to her closet.
    app.delete(
      "/wear-with/:id",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const deleted = await deleteStyling(
          { outfits, photos, storage, log: request.log },
          request.params.id,
          user.id,
        );
        if (!deleted) throw httpError(404, "request not found");
        return reply.code(204).send();
      },
    );

    // The picture of an item from a photo, to its owner only, cached like an item's photo.
    app.get(
      "/wear-with/:id/photo",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          querystring: z.object({ variant: z.enum(["photo", "cutout"]).default("photo") }),
        },
      },
      async (request, reply) => {
        const row = await outfits.getRequest(request.params.id);
        if (!row || row.userId !== (request.user as SessionUser).id || !row.heroPhotoKey) {
          throw httpError(404, "no photo");
        }
        const photo = await photos.get(row.heroPhotoKey);
        const key = request.query.variant === "cutout" ? photo?.cutoutKey : photo?.key;
        const file = key ? await storage.get(key) : null;
        if (!file) throw httpError(404, "no photo");
        // The key behind this URL can still change (the cut-out arrives), so no "immutable".
        return reply
          .header("content-type", file.contentType)
          .header("cache-control", "private, max-age=3600")
          .send(Buffer.from(file.body));
      },
    );

    // Cuts a piece's string in her look, or ties it back: this piece didn't work here.
    app.put(
      "/outfits/:id/pieces/:pieceId",
      {
        schema: {
          params: z.object({ id: z.string().uuid(), pieceId: z.string().uuid() }),
          body: pieceStrikeInput,
        },
      },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const done = await outfits.strike(
          request.params.id,
          request.params.pieceId,
          user.id,
          request.body.struck,
        );
        if (done === "missing") throw httpError(404, "piece not found");
        if (done === "hero") throw httpError(400, "the look is built around this piece");
        return reply.code(204).send();
      },
    );

    app.post(
      "/outfits/:id/reactions",
      { schema: { params: z.object({ id: z.string().uuid() }), body: outfitReactionInput } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const { reaction, reason } = request.body;
        const saved = await outfits.react(request.params.id, user.id, reaction, reason);
        if (!saved) throw httpError(404, "outfit not found");
        // The first brief may be due; the job decides.
        await queue.enqueueBrief(user.id);
        return reply.code(204).send();
      },
    );
  };
