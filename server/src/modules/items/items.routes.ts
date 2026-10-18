import { createItemInput, item } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import { photoPrefix } from "../photos/photos.routes";
import type { ItemsRepository } from "./items.repository";

export const itemsRoutes =
  (repo: ItemsRepository, storage: Storage, auth: Auth): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // requireUser has run by the time a handler is called, so the user is set.
    const userOf = (request: { user: SessionUser | null }) => request.user as SessionUser;

    app.get("/items", { schema: { response: { 200: z.array(item) } } }, (request) =>
      repo.list(userOf(request).id),
    );

    app.post(
      "/items",
      { schema: { body: createItemInput, response: { 201: item } } },
      async (request, reply) => {
        const user = userOf(request);
        const { photoKey } = request.body;
        // Only a photo this user uploaded, and that is really there, can be attached.
        if (
          photoKey !== undefined &&
          (!photoKey.startsWith(photoPrefix(user.id)) || !(await storage.exists(photoKey)))
        ) {
          throw httpError(400, "unknown photoKey");
        }
        const created = await repo.create(user.id, request.body);
        return reply.code(201).send(created);
      },
    );

    app.get(
      "/items/:id/photo",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        const key = await repo.photoKey(userOf(request).id, request.params.id);
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
  };
