import { randomUUID } from "node:crypto";
import { uploadedPhoto } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { PhotoQueue } from "../../queue/photo-queue";
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
    queue: PhotoQueue,
    auth: Auth,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // Multipart with one file field. The request only stores the original and queues it:
    // re-encoding (a second or more on a big photo) happens in the worker, so the app gets
    // its answer at once. The client sends photoKey on to POST /api/items straight away.
    app.post(
      "/photos",
      { schema: { response: { 201: uploadedPhoto } } },
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
        await photos.create({ key: photoKey, ownerId: user.id, uploadKey });
        // If queueing fails the request fails too; the row is never attached and the cleanup job removes it.
        await queue.enqueueProcessing(photoKey);
        return reply.code(201).send({ photoKey, status: "processing" as const });
      },
    );
  };
