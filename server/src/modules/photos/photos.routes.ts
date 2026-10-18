import { randomUUID } from "node:crypto";
import { uploadedPhoto } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import { processPhoto, UnsupportedPhotoError } from "./process-photo";

// Each user's photos live under their own prefix, which is how items.routes
// checks that a photoKey belongs to the caller.
export const photoPrefix = (userId: string) => `photos/${userId}/`;

export const photosRoutes =
  (storage: Storage, auth: Auth): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // Multipart with one file field. The photo is re-encoded here, so whatever the phone
    // sends, storage only ever holds a small WebP without metadata.
    app.post(
      "/photos",
      { schema: { response: { 201: uploadedPhoto } } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const file = await request.file();
        if (!file) throw httpError(400, "no file in the request");
        // Throws a 413 when the file is over the multipart fileSize limit.
        const input = await file.toBuffer();

        let photo: Uint8Array;
        try {
          photo = await processPhoto(input);
        } catch (error) {
          if (error instanceof UnsupportedPhotoError) throw httpError(415, error.message);
          throw error;
        }

        const photoKey = `${photoPrefix(user.id)}${randomUUID()}.webp`;
        await storage.put(photoKey, photo, "image/webp");
        return reply.code(201).send({ photoKey });
      },
    );
  };
