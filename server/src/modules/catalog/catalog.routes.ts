import { APP_LANGUAGES, catalogItem } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { Storage } from "../../storage/storage";
import { toCatalogItem, type CatalogRepository } from "./catalog.repository";

// A partner item's card and picture. Any signed-in user may see any catalog item: it's a
// brand's product, not someone's wardrobe.
export const catalogRoutes =
  (catalog: CatalogRepository, storage: Storage, auth: Auth): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    app.get(
      "/catalog/:id",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          response: { 200: catalogItem },
        },
      },
      async (request) => {
        const row = await catalog.get(request.params.id);
        if (!row) throw httpError(404, "no such catalog item");
        // The app asks for the card when it's opened: that is the "opened" brands see.
        await catalog.record([row.id], (request.user as SessionUser).id, "opened");
        return toCatalogItem(row, request.query.lang);
      },
    );

    app.get(
      "/catalog/:id/photo",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          // Only makes the URL change with the stored key (see catalogPhotoPath).
          querystring: z.object({ v: z.string().max(40).optional() }),
        },
      },
      async (request, reply) => {
        const row = await catalog.get(request.params.id);
        const photo = row ? await storage.get(row.imageKey) : null;
        if (!photo) throw httpError(404, "no photo");
        return reply
          .header("content-type", photo.contentType)
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(Buffer.from(photo.body));
      },
    );
  };
