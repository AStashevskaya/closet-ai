import { addWishInput, wish, wishAnswerInput, wishList, type Wish } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import { heroPath } from "../outfits/outfits.routes";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import type { PhotosRepository } from "../photos/photos.repository";
import type { WishRow, WishesRepository } from "./wishes.repository";

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

    // The wish as the app shows it: its piece from the request's photo. null when the photo is
    // gone (it can't be, while a request points to it, but a wish without it would show nothing).
    async function toWish(row: WishRow): Promise<Wish | null> {
      const request = await outfits.getRequest(row.requestId);
      const photo = request?.heroPhotoKey ? await photos.get(request.heroPhotoKey) : null;
      if (!request || !photo?.tags) return null;
      return {
        id: row.id,
        requestId: row.requestId,
        name: photo.tags.name,
        photoUrl: heroPath(row.requestId),
        cutoutUrl: photo.cutoutKey ? heroPath(row.requestId, "cutout") : null,
        call: request.verdict?.call ?? null,
        createdAt: row.createdAt.toISOString(),
        due: row.askAt.getTime() <= clock().getTime(),
      };
    }

    app.get("/wishes", { schema: { response: { 200: wishList } } }, async (request) => {
      const rows = await wishes.list((request.user as SessionUser).id);
      const listed = await Promise.all(rows.map(toWish));
      // The ones to answer first, then the newest.
      return listed.filter((w) => w !== null).sort((a, b) => Number(b.due) - Number(a.due));
    });

    // Saves an item-from-a-photo's request to her wishes; saving it again is the same wish.
    app.post(
      "/wishes",
      { schema: { body: addWishInput, response: { 201: wish } } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        const found = await outfits.getRequest(request.body.requestId);
        if (!found || found.userId !== user.id || !found.heroPhotoKey) {
          throw httpError(404, "request not found");
        }
        const askAt = new Date(clock().getTime() + WISH_ASK_AFTER_MS);
        const id = await wishes.add(user.id, found.id, askAt);
        const row = (await wishes.list(user.id)).find((w) => w.id === id)!;
        const saved = await toWish(row);
        if (!saved) throw httpError(404, "request not found");
        return reply.code(201).send(saved);
      },
    );

    // still: asked again in a week; no, bought: let go (bought pieces are added to the wardrobe
    // by the app first, through POST /api/items).
    app.post(
      "/wishes/:id/answer",
      { schema: { params: z.object({ id: z.string().uuid() }), body: wishAnswerInput } },
      async (request, reply) => {
        const userId = (request.user as SessionUser).id;
        const { id } = request.params;
        const done =
          request.body.answer === "still"
            ? await wishes.keep(userId, id, new Date(clock().getTime() + WISH_ASK_AFTER_MS))
            : await wishes.remove(userId, id);
        if (!done) throw httpError(404, "wish not found");
        return reply.code(204).send();
      },
    );
  };
