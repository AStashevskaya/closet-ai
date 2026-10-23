import {
  addWishInput,
  wish,
  wishAnswerInput,
  wishesDue,
  wishList,
  type Wish,
} from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import { heroPath } from "../outfits/outfits.routes";
import type { PhotosRepository } from "../photos/photos.repository";
import type { WishesRepository, WishRow } from "./wishes.repository";

// A week to cool off before asking whether she still wants it.
export const WISH_ASK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Wishes: pieces from photos the user wants to buy, and the weekly "still want it?".
export const wishesRoutes =
  (
    wishes: WishesRepository,
    outfits: OutfitsRepository,
    photos: PhotosRepository,
    auth: Auth,
    clock: () => Date = () => new Date(),
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    const toWish = (row: WishRow): Wish => ({
      id: row.id,
      requestId: row.requestId,
      name: row.name,
      photoUrl: heroPath(row.requestId),
      cutoutUrl: row.cutoutKey ? heroPath(row.requestId, "cutout") : null,
      call: row.call,
      createdAt: row.createdAt.toISOString(),
      due: row.askAt.getTime() <= clock().getTime(),
    });

    app.get("/wishes", { schema: { response: { 200: wishList } } }, async (request) => {
      const rows = await wishes.list((request.user as SessionUser).id);
      // The ones to answer first, then the newest.
      return rows.map(toWish).sort((a, b) => Number(b.due) - Number(a.due));
    });

    // Just the number waiting for an answer, for the menu row.
    app.get(
      "/wishes/due",
      { schema: { response: { 200: wishesDue } } },
      async (request) => ({
        count: await wishes.countDue((request.user as SessionUser).id, clock()),
      }),
    );

    // Saves an item-from-a-photo's request to her wishes; saving it again is the same wish.
    app.post(
      "/wishes",
      { schema: { body: addWishInput, response: { 201: wish } } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const found = await outfits.getRequest(request.body.requestId);
        const photo = found?.heroPhotoKey ? await photos.get(found.heroPhotoKey) : null;
        // Checked before saving: a wish the list can't show would be saved for nothing.
        if (!found || found.userId !== user.id || !photo?.tags) {
          throw httpError(404, "request not found");
        }
        if (await outfits.isAttached(photo.key)) throw httpError(409, "already in the closet");
        const saved = await wishes.add(
          user.id,
          found.id,
          new Date(clock().getTime() + WISH_ASK_AFTER_MS),
        );
        return reply.code(201).send(toWish(saved));
      },
    );

    // still: asked again in a week, once it's due (409 before); no, bought: let go (bought pieces
    // are added to the wardrobe by the app first, which lets the wish go by itself).
    app.post(
      "/wishes/:id/answer",
      { schema: { params: z.object({ id: z.string().uuid() }), body: wishAnswerInput } },
      async (request, reply) => {
        const userId = (request.user as SessionUser).id;
        const { id } = request.params;
        if (request.body.answer === "still") {
          const now = clock();
          const result = await wishes.keep(
            userId,
            id,
            now,
            new Date(now.getTime() + WISH_ASK_AFTER_MS),
          );
          if (result === "missing") throw httpError(404, "wish not found");
          if (result === "not-due") throw httpError(409, "not asked yet");
        } else if (!(await wishes.remove(userId, id))) {
          throw httpError(404, "wish not found");
        }
        return reply.code(204).send();
      },
    );
  };
