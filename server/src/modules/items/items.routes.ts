import { createItemInput, item } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import type { ItemsRepository } from "./items.repository";

export const itemsRoutes =
  (repo: ItemsRepository, auth: Auth): FastifyPluginAsyncZod =>
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
        const created = await repo.create(userOf(request).id, request.body);
        return reply.code(201).send(created);
      },
    );
  };
