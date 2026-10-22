import { randomUUID } from "node:crypto";
import {
  APP_LANGUAGES,
  outfitReactionInput,
  styledList,
  wearWithInput,
  wearWithRequest,
  wearWithStarted,
  type Item,
  type StyledEntry,
  type WearWithRequest,
} from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import type { ItemsRepository } from "../items/items.repository";
import type { PhotosRepository } from "../photos/photos.repository";
import { photoPrefix } from "../photos/photos.routes";
import { cropToBox } from "../photos/process-photo";
import type { Limits } from "../usage/limits";
import type { OutfitQueue } from "./outfit-jobs";
import type { WishesRepository } from "../wishes/wishes.repository";
import type { OutfitsRepository } from "./outfits.repository";

// Styled items listed at most, newest first.
const HISTORY_LIMIT = 30;

// The photo of an item from a photo, served by the API like an item's: by request id.
export const heroPath = (requestId: string, variant?: "cutout") =>
  `/api/wear-with/${requestId}/photo${variant ? `?variant=${variant}` : ""}`;

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

        if ("itemId" in request.body) {
          const { itemId } = request.body;
          if (!(await items.get(user.id, itemId))) throw httpError(404, "item not found");
          // Reused while neither the wardrobe nor the user's taste (the brief) has changed since.
          const last = await outfits.latestDone(user.id, itemId, mood);
          const writtenAt = (await outfits.brief(user.id))?.writtenAt;
          if (last && last.wardrobeSize === size && (!writtenAt || last.createdAt > writtenAt)) {
            return reply.code(200).send({ id: last.id });
          }
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
          const file = await storage.get(photo.key);
          if (!file) throw httpError(409, "the photo is not ready");
          await limits.check(user.id, "wear_with");

          const key = `${photoPrefix(user.id)}${randomUUID()}.webp`;
          await storage.put(key, await cropToBox(file.body, found.box), "image/webp");
          const { box: _box, ...tags } = found;
          await photos.createReady({ key, ownerId: user.id, tags: { ...tags, recognized: true } });
          hero = { heroPhotoKey: key, heroNoun: found.noun };
        }

        const id = await outfits.createRequest(user.id, hero, size, mood);
        await queue.enqueueComposing(id, request.query.lang);
        await limits.record(user.id, "wear_with");
        // A new brief is written in the background when the old one is stale; the job decides.
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
        const entries = await Promise.all(
          rows.map(async (row): Promise<StyledEntry | null> => {
            const base = {
              id: row.id,
              createdAt: row.createdAt.toISOString(),
              mood: row.mood,
            };
            if (row.itemId) {
              const item = await items.get(user.id, row.itemId);
              if (!item) return null;
              return {
                ...base,
                name: item.name,
                photoUrl: item.photoUrl ?? null,
                cutoutUrl: item.cutoutUrl ?? null,
              };
            }
            const photo = row.heroPhotoKey ? await photos.get(row.heroPhotoKey) : null;
            if (!photo?.tags) return null;
            return {
              ...base,
              name: photo.tags.name,
              photoUrl: heroPath(row.id),
              cutoutUrl: photo.cutoutKey ? heroPath(row.id, "cutout") : null,
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
        const found = await outfits.view(request.params.id, user.id, request.query.lang);
        const row = await outfits.getRequest(request.params.id);
        if (!found || !row) throw httpError(404, "request not found");
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

    app.post(
      "/outfits/:id/reactions",
      { schema: { params: z.object({ id: z.string().uuid() }), body: outfitReactionInput } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const saved = await outfits.react(request.params.id, user.id, request.body.reaction);
        if (!saved) throw httpError(404, "outfit not found");
        // Reactions make the brief stale after a few; the job decides.
        await queue.enqueueBrief(user.id);
        return reply.code(204).send();
      },
    );
  };
