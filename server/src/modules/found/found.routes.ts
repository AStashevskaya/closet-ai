import { APP_LANGUAGES, foundPiece, foundWear, foundWearInput } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
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

    // The week's find and its looks, as GET /api/found answers; and her city's today.
    async function findFor(userId: string, lang: string) {
      const now = clock();
      // `wardrobe` holds the pieces with a ready photo and what styling reads; `closet` their
      // dates and what the app shows. Two reads: neither has both.
      const [wardrobe, closet, history, struck, today] = await Promise.all([
        outfits.wardrobe(userId),
        items.list(userId),
        outfits.wearHistory(userId, new Date(now.getTime() - HISTORY_MS)),
        outfits.struckPairs(userId, STRUCK_PAIRS),
        todayOf(userId, lang, now),
      ]);
      const week = mondayOf(today);
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
        { season, now, userId, week },
      );
      const options = { season, struck: new Set(struck), wornPairs: new Set(history.wornPairs) };
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
        return { find: { piece: byId.get(pieceId)!, looks, week }, today, wardrobe };
      }
      return { find: { piece: null, looks: [], week }, today, wardrobe };
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
        const { find } = await findFor((request.user as SessionUser).id, request.query.lang);
        return find;
      },
    );

    // "I'll wear it" (owner, 2026-11-12): one of the find's looks becomes tomorrow's look of the
    // day, tomorrow in her city as the look of the day counts days. Sent again with the same
    // pieces it answers the same; 409 when tomorrow already has another look she has seen.
    app.post(
      "/found/wear",
      {
        schema: {
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          body: foundWearInput,
          response: { 200: foundWear },
        },
      },
      async (request) => {
        const userId = (request.user as SessionUser).id;
        const { lang } = request.query;
        const ids = [...new Set(request.body.pieces)];
        const { find, today, wardrobe } = await findFor(userId, lang);
        const hers = new Set(wardrobe.map((p) => p.id));
        if (!ids.every((id) => hers.has(id))) throw httpError(404, "Item not found");
        const same = (pieces: string[]) =>
          pieces.length === ids.length && pieces.every((id) => ids.includes(id));
        // Only one of the looks this week's find offers: not any look sent our way.
        if (!find.looks.some((look) => same(look.pieces.map((p) => p.id))))
          throw httpError(400, "Not one of this week's looks");
        const date = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
          .toISOString()
          .slice(0, 10);
        const existing = await outfits.findDailyRequest(userId, date);
        if (existing) {
          const looks = (await outfits.view(existing, userId, lang))?.outfits ?? [];
          const first = looks[0]?.pieces.flatMap((p) => (p.item ? [p.item.id] : [])) ?? [];
          if (looks.length > 0 && same(first)) return { date };
          if (looks.length > 0) throw httpError(409, "Tomorrow already has a look");
        }
        const requestId = existing ?? (await outfits.dailyRequest(userId, date, wardrobe.length));
        const added = await outfits.addDailyLook(
          requestId,
          userId,
          {
            caption: "",
            occasion: "",
            why: "",
            missing: null,
            pieces: ids.map((itemId) => ({ hero: false, itemId })),
          },
          0,
        );
        // Another tap or device got there first: fine if it was this look.
        if (!added) {
          const looks = (await outfits.view(requestId, userId, lang))?.outfits ?? [];
          const first = looks[0]?.pieces.flatMap((p) => (p.item ? [p.item.id] : [])) ?? [];
          if (!same(first)) throw httpError(409, "Tomorrow already has a look");
        }
        return { date };
      },
    );
  };
