import { randomUUID } from "node:crypto";
import {
  createItemInput,
  item,
  itemDetail,
  itemList,
  similarItems,
  updateItemInput,
} from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import type { PhotoQueue } from "../../queue/photo-queue";
import { cutoutKeyFor, deletePhoto } from "../photos/photo-jobs";
import { photoPrefix } from "../photos/photos.routes";
import { rotateQuarter } from "../photos/process-photo";
import type { PhotosRepository } from "../photos/photos.repository";
import type { ItemsRepository } from "./items.repository";

// One row on the item screen.
const SIMILAR_LIMIT = 6;

export const itemsRoutes =
  (
    repo: ItemsRepository,
    photos: PhotosRepository,
    storage: Storage,
    photoQueue: PhotoQueue,
    auth: Auth,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // requireUser has run by the time a handler is called, so the user is set.
    const userOf = (request: { user: SessionUser | null }) => request.user as SessionUser;

    app.get("/items", { schema: { response: { 200: itemList } } }, (request) =>
      repo.list(userOf(request).id),
    );

    app.get(
      "/items/:id",
      { schema: { params: z.object({ id: z.string().uuid() }), response: { 200: itemDetail } } },
      async (request) => {
        const found = await repo.get(userOf(request).id, request.params.id);
        if (!found) throw httpError(404, "item not found");
        return found;
      },
    );

    // "Similar in your wardrobe" on the item screen.
    app.get(
      "/items/:id/similar",
      {
        schema: { params: z.object({ id: z.string().uuid() }), response: { 200: similarItems } },
      },
      async (request) => {
        const found = await repo.similar(userOf(request).id, request.params.id, SIMILAR_LIMIT);
        if (!found) throw httpError(404, "item not found");
        return found;
      },
    );

    // The item screen saves the user's corrections here: name, category, colors, seasons.
    app.patch(
      "/items/:id",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          body: updateItemInput,
          response: { 200: itemDetail },
        },
      },
      async (request) => {
        const updated = await repo.update(userOf(request).id, request.params.id, request.body);
        if (!updated) throw httpError(404, "item not found");
        return updated;
      },
    );

    // The item screen's "rotate": the photo and its cut-out turned a quarter clockwise, stored
    // under new keys (so the new URLs miss the phone's cache) in place of the old ones.
    app.post(
      "/items/:id/rotate",
      { schema: { params: z.object({ id: z.string().uuid() }), response: { 200: itemDetail } } },
      async (request) => {
        const user = userOf(request);
        const { id } = request.params;
        const key = await repo.photoKey(user.id, id, "photo");
        if (!key) throw httpError(404, "no photo");
        const photo = await photos.get(key);
        const file = photo?.status === "ready" ? await storage.get(key) : null;
        if (!photo || !file) throw httpError(409, "photo not ready");

        const turnedKey = `${photoPrefix(user.id)}${randomUUID()}.webp`;
        await storage.put(turnedKey, await rotateQuarter(file.body), "image/webp");
        const cutout = photo.cutoutKey ? await storage.get(photo.cutoutKey) : null;
        const turnedCutoutKey = cutout ? cutoutKeyFor(turnedKey) : null;
        if (cutout && turnedCutoutKey) {
          await storage.put(turnedCutoutKey, await rotateQuarter(cutout.body), "image/webp");
        }
        await photos.copyAs(key, { key: turnedKey, cutoutKey: turnedCutoutKey });
        if (!(await repo.setPhotoKey(user.id, id, turnedKey)))
          throw httpError(404, "item not found");

        try {
          await deletePhoto({ photos, storage }, key);
        } catch (error) {
          // Unattached now, so the hourly cleanup tries again.
          request.log.warn({ err: error, key }, "failed to delete the unturned photo");
        }
        // The copied embedding is of the photo as it was; "similar" compares upright items better.
        try {
          await photoQueue.enqueueEmbedding(turnedKey);
        } catch (error) {
          request.log.warn({ err: error, key: turnedKey }, "failed to queue the embedding");
        }
        const turned = await repo.get(user.id, id);
        if (!turned) throw httpError(404, "item not found");
        return turned;
      },
    );

    app.post(
      "/items",
      { schema: { body: createItemInput, response: { 201: item } } },
      async (request, reply) => {
        const user = userOf(request);
        const { photoKey } = request.body;
        // Only a photo this user uploaded can be attached. It may still be processing
        // (the app saves right after the upload); a photo that failed can't.
        if (photoKey !== undefined) {
          const photo = await photos.get(photoKey);
          if (!photo || photo.ownerId !== user.id || photo.status === "failed") {
            throw httpError(400, "unknown photoKey");
          }
        }
        const created = await repo.create(user.id, request.body);
        return reply.code(201).send(created);
      },
    );

    app.get(
      "/items/:id/photo",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          // The cut-out has its own URL, so the phone's cache of the photo stays valid. `v` only
          // makes the URL change with the stored key (see photoPath).
          querystring: z.object({
            variant: z.enum(["photo", "cutout"]).default("photo"),
            v: z.string().max(40).optional(),
          }),
        },
      },
      async (request, reply) => {
        const key = await repo.photoKey(
          userOf(request).id,
          request.params.id,
          request.query.variant,
        );
        const photo = key ? await storage.get(key) : null;
        if (!photo) throw httpError(404, "no photo");

        // A key never changes content (a new photo gets a new key), so the phone can cache it
        // for good; "private" keeps shared caches from storing someone's wardrobe.
        return reply
          .header("content-type", photo.contentType)
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(Buffer.from(photo.body));
      },
    );

    app.delete(
      "/items/:id",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        // The row goes first: a leftover file is harmless, an item pointing at a missing file is not.
        const deleted = await repo.delete(userOf(request).id, request.params.id);
        if (!deleted) throw httpError(404, "item not found");

        if (deleted.photoKey) {
          try {
            await deletePhoto({ photos, storage }, deleted.photoKey);
          } catch (error) {
            // The item is already gone, so the client still gets 204. The photo is now
            // unattached, so the hourly cleanup job tries again.
            request.log.warn({ err: error, key: deleted.photoKey }, "failed to delete item photo");
          }
        }
        return reply.code(204).send();
      },
    );
  };
