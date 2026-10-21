import {
  APP_LANGUAGES,
  outfitReactionInput,
  wearWithInput,
  wearWithRequest,
  wearWithStarted,
} from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { ItemsRepository } from "../items/items.repository";
import type { Limits } from "../usage/limits";
import type { OutfitQueue } from "./outfit-jobs";
import type { OutfitsRepository } from "./outfits.repository";

export const outfitsRoutes =
  (
    outfits: OutfitsRepository,
    items: ItemsRepository,
    queue: OutfitQueue,
    limits: Limits,
    auth: Auth,
    // false when no API key is configured: there is no stylist to ask.
    enabled: boolean,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // "What do I wear this with?" for a wardrobe item. Answers 202 with a request to poll, or
    // 200 with the last one for this item while the wardrobe hasn't changed size: asking again
    // shows the same outfits for free.
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
        const { itemId } = request.body;
        if (!(await items.get(user.id, itemId))) throw httpError(404, "item not found");

        const size = await outfits.wardrobeSize(user.id);
        const last = await outfits.latestDone(user.id, itemId);
        if (last && last.wardrobeSize === size) return reply.code(200).send({ id: last.id });

        await limits.check(user.id, "wear_with");
        const id = await outfits.createRequest(user.id, itemId, size);
        await queue.enqueueComposing(id, request.query.lang);
        await limits.record(user.id, "wear_with");
        // A new brief is written in the background when the old one is stale; the job decides.
        await queue.enqueueBrief(user.id);
        return reply.code(202).send({ id });
      },
    );

    app.get(
      "/wear-with/:id",
      {
        schema: { params: z.object({ id: z.string().uuid() }), response: { 200: wearWithRequest } },
      },
      async (request) => {
        const found = await outfits.view(request.params.id, (request.user as SessionUser).id);
        if (!found) throw httpError(404, "request not found");
        return found;
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
