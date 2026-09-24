import { createItemInput, item } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ItemsRepository } from "./items.repository";

export const itemsRoutes =
  (repo: ItemsRepository): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/items", { schema: { response: { 200: z.array(item) } } }, () => repo.list());

    app.post(
      "/items",
      { schema: { body: createItemInput, response: { 201: item } } },
      async (request, reply) => {
        const created = await repo.create(request.body);
        return reply.code(201).send(created);
      },
    );
  };
