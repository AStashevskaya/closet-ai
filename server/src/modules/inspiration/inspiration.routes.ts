import { inspirationList } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import type { OutfitQueue } from "../outfits/outfit-jobs";
import { deletePhoto } from "../photos/photo-jobs";
import type { PhotosRepository } from "../photos/photos.repository";

// Looks are uploaded through POST /api/photos?kind=inspiration; these list, show and delete them.
// The key travels in the query because it contains slashes.
const photoPath = (key: string) => `/api/inspiration/photo?key=${encodeURIComponent(key)}`;

export const inspirationRoutes =
  (
    photos: PhotosRepository,
    storage: Storage,
    queue: OutfitQueue,
    auth: Auth,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    const ownLook = async (userId: string, key: string) => {
      const photo = await photos.get(key);
      // Someone else's photo, or another kind, answers like a missing one.
      if (!photo || photo.ownerId !== userId || photo.kind !== "inspiration") {
        throw httpError(404, "look not found");
      }
      return photo;
    };

    app.get("/inspiration", { schema: { response: { 200: inspirationList } } }, async (request) => {
      const saved = await photos.listInspiration((request.user as SessionUser).id);
      return saved.map(({ key, createdAt }) => ({
        key,
        url: photoPath(key),
        createdAt: createdAt.toISOString(),
      }));
    });

    app.get(
      "/inspiration/photo",
      { schema: { querystring: z.object({ key: z.string().max(200) }) } },
      async (request, reply) => {
        const photo = await ownLook((request.user as SessionUser).id, request.query.key);
        const file = await storage.get(photo.key);
        if (!file) throw httpError(404, "look not found");
        // A key never changes content, so the phone can keep it.
        return reply
          .header("content-type", file.contentType)
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(Buffer.from(file.body));
      },
    );

    app.delete(
      "/inspiration",
      { schema: { querystring: z.object({ key: z.string().max(200) }) } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        await ownLook(user.id, request.query.key);
        await deletePhoto({ photos, storage }, request.query.key);
        // Fewer saved looks can change the brief too.
        await queue.enqueueBrief(user.id, BRIEF_AFTER_SAVE_MS);
        return reply.code(204).send();
      },
    );
  };

// Saved looks usually come a few at a time: the brief waits a little to read them together.
export const BRIEF_AFTER_SAVE_MS = 2 * 60 * 1000;
