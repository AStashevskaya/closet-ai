import { randomUUID } from "node:crypto";
import {
  addLookItemsInput,
  APP_LANGUAGES,
  itemList,
  PHOTO_KINDS,
  photoState,
  uploadedPhoto,
} from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { PhotoQueue } from "../../queue/photo-queue";
import type { ItemsRepository } from "../items/items.repository";
import { addItemsFromLook } from "./look-items";
import type { Storage } from "../../storage/storage";
import type { PhotosRepository } from "./photos.repository";
import { checkPhoto, UnsupportedPhotoError } from "./process-photo";

// Each user's photos live under their own prefix.
export const photoPrefix = (userId: string) => `photos/${userId}/`;
// Originals wait here until the worker has turned them into a WebP, then they are deleted.
const uploadPrefix = (userId: string) => `uploads/${userId}/`;

export const photosRoutes =
  (
    storage: Storage,
    photos: PhotosRepository,
    items: ItemsRepository,
    queue: PhotoQueue,
    auth: Auth,
    // false when no API key is configured: photos are processed but not tagged.
    taggingEnabled: boolean,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // Multipart with one file field. The request only stores the original and queues it:
    // re-encoding (a second or more on a big photo) happens in the worker, so the app gets
    // its answer at once. The client sends photoKey on to POST /api/items straight away.
    app.post(
      "/photos",
      {
        schema: {
          // The language for the suggested item name (the app's current language), and
          // whether the photo shows one item or a whole outfit to pick items from.
          querystring: z.object({
            lang: z.enum(APP_LANGUAGES).default("en"),
            kind: z.enum(PHOTO_KINDS).default("item"),
          }),
          response: { 201: uploadedPhoto },
        },
      },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const file = await request.file();
        if (!file) throw httpError(400, "no file in the request");
        // Throws a 413 when the file is over the multipart fileSize limit.
        const input = await file.toBuffer();

        let contentType: string;
        try {
          contentType = await checkPhoto(input);
        } catch (error) {
          if (error instanceof UnsupportedPhotoError) throw httpError(415, error.message);
          throw error;
        }

        const id = randomUUID();
        const photoKey = `${photoPrefix(user.id)}${id}.webp`;
        const uploadKey = `${uploadPrefix(user.id)}${id}`;
        await storage.put(uploadKey, input, contentType);
        await photos.create({
          key: photoKey,
          ownerId: user.id,
          uploadKey,
          kind: request.query.kind,
          tagStatus: taggingEnabled ? "pending" : null,
        });
        // If queueing fails the request fails too; the row is never attached and the cleanup job removes it.
        await queue.enqueueProcessing(photoKey, request.query.lang);
        return reply.code(201).send({ photoKey, status: "processing" as const });
      },
    );

    // The add-item form polls this until the photo is processed and tagged, then pre-fills
    // itself from the tags. The key goes in the query because it contains slashes.
    app.get(
      "/photos/status",
      {
        schema: {
          querystring: z.object({ key: z.string().max(200) }),
          response: { 200: photoState },
        },
      },
      async (request) => {
        const photo = await photos.get(request.query.key);
        // Someone else's photo answers like a missing one.
        if (!photo || photo.ownerId !== (request.user as SessionUser).id) {
          throw httpError(404, "photo not found");
        }
        return {
          status: photo.status,
          tagStatus: photo.tagStatus,
          tags: photo.tags,
          lookItems: photo.lookItems,
        };
      },
    );

    // Adds the items the user picked from a look photo to the wardrobe.
    app.post(
      "/photos/look-items",
      { schema: { body: addLookItemsInput, response: { 201: itemList } } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const result = await addItemsFromLook(
          { photos, items, storage, queue },
          user.id,
          request.body,
        );
        if (result === "not-found") throw httpError(404, "photo not found");
        if (result === "not-ready") throw httpError(409, "the photo's items are not found yet");
        if (result === "bad-index") throw httpError(400, "no such item on the photo");
        return reply.code(201).send(result);
      },
    );
  };
