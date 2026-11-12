import { APP_LANGUAGES, foundPiece } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { mondayOf } from "../../weather/weather";
import type { ItemsRepository } from "../items/items.repository";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import { seasonOf } from "../outfits/wardrobe-sheet";
import { looksWith, pickFound } from "./found-piece";

// How many of her latest cut pairs count against a look, as for the look of the day.
const STRUCK_PAIRS = 40;

// "Look what turned up": the week's find and three looks with it, by rules (src/modules/found).
export const foundRoutes =
  (
    outfits: OutfitsRepository,
    items: ItemsRepository,
    auth: Auth,
    clock: () => Date,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    app.get(
      "/found",
      {
        schema: {
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          response: { 200: foundPiece },
        },
      },
      async (request) => {
        const userId = (request.user as SessionUser).id;
        const now = clock();
        const season = seasonOf(now);
        const [wardrobe, closet, history, struck] = await Promise.all([
          outfits.wardrobe(userId),
          items.list(userId),
          outfits.wearHistory(userId),
          outfits.struckPairs(userId, STRUCK_PAIRS),
        ]);
        // Only pieces with a ready photo can be styled: `wardrobe` holds those.
        const ready = new Set(wardrobe.map((p) => p.id));
        const pieceId = pickFound(
          closet
            .filter((item) => ready.has(item.id))
            .map((item) => ({
              id: item.id,
              category: item.category,
              seasons: item.seasons,
              createdAt: new Date(item.createdAt),
            })),
          history.pieces,
          { season, now, userId, week: mondayOf(now.toISOString().slice(0, 10)) },
        );
        if (!pieceId) return { piece: null, looks: [] };
        const looks = looksWith(wardrobe, pieceId, {
          season,
          struck: new Set(struck),
          wornPairs: new Set(history.wornPairs),
        });
        // A find with nothing to wear it with isn't shown: that would be a reproach after all.
        if (looks.length === 0) return { piece: null, looks: [] };
        const byId = new Map(closet.map((item) => [item.id, item]));
        return {
          piece: byId.get(pieceId)!,
          looks: looks.map((ids) => ({ pieces: ids.flatMap((id) => byId.get(id) ?? []) })),
        };
      },
    );
  };
