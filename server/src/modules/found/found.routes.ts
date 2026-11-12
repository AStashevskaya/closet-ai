import { APP_LANGUAGES, foundPiece } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { localDate, mondayOf, type WeatherClient } from "../../weather/weather";
import type { ItemsRepository } from "../items/items.repository";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import { seasonOf } from "../outfits/wardrobe-sheet";
import type { ProfileRepository } from "../profile/profile.repository";
import { looksWith, pickFound } from "./found-piece";

// How many of her latest cut pairs count against a look, as for the look of the day.
const STRUCK_PAIRS = 40;
// How far back her wears are read: a year covers every season once.
const HISTORY_MS = 365 * 86_400_000;
// The finds tried in turn until one has looks to wear it with.
const TRIES = 5;

// "Look what turned up": the week's find and three looks with it, by rules (src/modules/found).
export const foundRoutes =
  (
    outfits: OutfitsRepository,
    items: ItemsRepository,
    profiles: ProfileRepository,
    weather: WeatherClient | null,
    auth: Auth,
    clock: () => Date,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // Her day in her city, for the week the find belongs to; the server's (UTC) without one.
    async function todayOf(userId: string, lang: string, now: Date) {
      const { city, country } = await profiles.get(userId);
      if (city && weather) {
        try {
          const week = await weather.week({ city, country }, lang);
          if (week) return week.today;
        } catch (cause) {
          app.log.warn({ err: cause }, "the weather didn't answer");
        }
      }
      return localDate(now.getTime(), 0);
    }

    app.get(
      "/found",
      {
        schema: {
          // Only for the weather's lookup of her city; the pieces carry their own names.
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          response: { 200: foundPiece },
        },
      },
      async (request) => {
        const userId = (request.user as SessionUser).id;
        const now = clock();
        // `wardrobe` holds the pieces with a ready photo and what styling reads; `closet` their
        // dates and what the app shows. Two reads: neither has both.
        const [wardrobe, closet, history, struck, today] = await Promise.all([
          outfits.wardrobe(userId),
          items.list(userId),
          outfits.wearHistory(userId, new Date(now.getTime() - HISTORY_MS)),
          outfits.struckPairs(userId, STRUCK_PAIRS),
          todayOf(userId, request.query.lang, now),
        ]);
        // Her season and week by her city's day, as the look of the day goes.
        const season = seasonOf(new Date(`${today}T12:00:00Z`));
        const ready = new Set(wardrobe.map((p) => p.id));
        const finds = pickFound(
          closet
            .filter((item) => ready.has(item.id))
            .map((item) => ({
              id: item.id,
              category: item.category,
              seasons: item.seasons,
              createdAt: new Date(item.createdAt),
            })),
          history.pieces,
          { season, now, userId, week: mondayOf(today) },
        );
        const options = {
          season,
          struck: new Set(struck),
          wornPairs: new Set(history.wornPairs),
        };
        const byId = new Map(closet.map((item) => [item.id, item]));
        // The first find she can wear with something; a find with nothing to wear it with
        // would be a reproach after all.
        for (const pieceId of finds.slice(0, TRIES)) {
          // A look with a piece deleted between the two reads goes whole: never one without its
          // shoes or its other half.
          const looks = looksWith(wardrobe, pieceId, options).flatMap((ids) => {
            const pieces = ids.flatMap((id) => byId.get(id) ?? []);
            return pieces.length === ids.length ? [{ pieces }] : [];
          });
          if (looks.length === 0) continue;
          return { piece: byId.get(pieceId)!, looks };
        }
        return { piece: null, looks: [] };
      },
    );
  };
