import { APP_LANGUAGES, todayWeek, type TodayWeek } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { localDate, type DayWeather, type WeatherClient } from "../../weather/weather";
import { RECENT_REQUESTS } from "../outfits/outfit-jobs";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import { seasonOf } from "../outfits/wardrobe-sheet";
import type { ProfileRepository } from "../profile/profile.repository";
import { dailyLook, needOf } from "./daily-look";

// How many of her latest cut pairs count against the look of the day.
const STRUCK_PAIRS = 40;

// Her week for the look of the day: the weather in her city from Monday to Sunday, and the days she
// wore a look. The look itself comes next (docs/product.md, look of the day).
export const todayRoutes =
  (
    profiles: ProfileRepository,
    outfits: OutfitsRepository,
    weather: WeatherClient | null,
    auth: Auth,
    clock: () => Date,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    // The day's look: the newest on her request for the day, made by the rules the first time
    // (and on "another", with the looks already shown passed over). Rules, so no cost.
    async function lookOfTheDay(
      userId: string,
      day: string,
      weatherToday: DayWeather | null,
      lang: (typeof APP_LANGUAGES)[number],
      // "Another": how many looks her screen showed. Undefined: just today's look.
      after: number | undefined,
    ): Promise<Pick<TodayWeek, "look" | "missing" | "shown" | "more">> {
      const existing = await outfits.findDailyRequest(userId, day);
      const shown = existing ? ((await outfits.view(existing, userId, lang))?.outfits ?? []) : [];
      const current = { look: shown.at(-1) ?? null, missing: [], shown: shown.length, more: true };
      // Today's look already made, or "another" from a screen that's behind (a tap sent twice,
      // or another device): what's there.
      if (shown.length > 0 && (after === undefined || after !== shown.length)) return current;

      const wardrobe = await outfits.wardrobe(userId);
      const season = seasonOf(clock());
      const recent = await outfits.recentlyUsed(userId, RECENT_REQUESTS);
      const pick = dailyLook(wardrobe, {
        season,
        need: needOf(weatherToday, season),
        recent: recent.pieces,
        struck: new Set(await outfits.struckPairs(userId, STRUCK_PAIRS)),
        skip: shown.length,
      });
      if ("missing" in pick) return { ...current, missing: pick.missing };
      if ("exhausted" in pick) return { ...current, more: false };
      // The day's request is made only once there's a look for it.
      const requestId = existing ?? (await outfits.dailyRequest(userId, day, wardrobe.length));
      // Words come from the app, by the day's weather: the rules write none. A racing request may
      // have added first; then its look is the day's.
      await outfits.addDailyLook(
        requestId,
        userId,
        {
          caption: "",
          occasion: "",
          why: "",
          missing: null,
          pieces: pick.pieces.map((itemId) => ({ hero: false, itemId })),
        },
        shown.length,
      );
      const looks = (await outfits.view(requestId, userId, lang))?.outfits ?? [];
      return { look: looks.at(-1) ?? null, missing: [], shown: looks.length, more: true };
    }

    // Her week and its weather, for the look of the day.
    async function weekOf(userId: string, lang: string) {
      const { city, country } = await profiles.get(userId);
      if (!city) return { status: "no-city" as const, week: null };
      if (!weather) return { status: "unavailable" as const, week: null };
      try {
        const week = await weather.week({ city, country }, lang);
        return { status: week ? ("ok" as const) : ("not-found" as const), week };
      } catch (cause) {
        app.log.warn({ err: cause }, "the weather didn't answer");
        return { status: "unavailable" as const, week: null };
      }
    }

    const answer = async (
      userId: string,
      lang: (typeof APP_LANGUAGES)[number],
      after: number | undefined,
    ): Promise<TodayWeek> => {
      const { status, week } = await weekOf(userId, lang);
      // Her city's day when the weather is known; else the server's.
      const day = week?.today ?? localDate(clock().getTime(), 0);
      const today = week?.days.find((d) => d.date === day) ?? null;
      // Without the weather the day is the server's (UTC): in Minsk after midnight that's yesterday
      // for up to three hours, until the weather answers again.
      const daily = await lookOfTheDay(userId, day, today, lang, after);
      if (!week) return { status, place: null, today: null, days: [], ...daily };
      // Monday 00:00 in her city, and each mark on the day it was there.
      const monday = Date.parse(`${week.days[0]!.date}T00:00:00Z`) - week.offsetSeconds * 1000;
      const worn = new Set(await outfits.woreDays(userId, new Date(monday), week.offsetSeconds));
      return {
        status,
        place: week.place,
        today: week.today,
        days: week.days.map((d) => ({ ...d, wore: worn.has(d.date) })),
        ...daily,
      };
    };

    app.get(
      "/today",
      {
        schema: {
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          response: { 200: todayWeek },
        },
      },
      (request) => answer((request.user as SessionUser).id, request.query.lang, undefined),
    );

    // "Another": the next look by the rules, kept as the day's.
    app.post(
      "/today/another",
      {
        schema: {
          querystring: z.object({
            lang: z.enum(APP_LANGUAGES).default("en"),
            // How many looks her screen showed: a tap sent twice adds one.
            shown: z.coerce.number().int().min(0),
          }),
          response: { 200: todayWeek },
        },
      },
      (request) =>
        answer((request.user as SessionUser).id, request.query.lang, request.query.shown),
    );
  };
