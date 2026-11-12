import { APP_LANGUAGES, todayWeek, type TodayWeek } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import type { WeatherClient } from "../../weather/weather";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import type { ProfileRepository } from "../profile/profile.repository";

// Her week for the look of the day: the weather in her city from Monday to Sunday, and the days she
// wore a look. The look itself comes next (docs/product.md, look of the day).
export const todayRoutes =
  (
    profiles: ProfileRepository,
    outfits: OutfitsRepository,
    weather: WeatherClient | null,
    auth: Auth,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    app.get(
      "/today",
      {
        schema: {
          querystring: z.object({ lang: z.enum(APP_LANGUAGES).default("en") }),
          response: { 200: todayWeek },
        },
      },
      async (request): Promise<TodayWeek> => {
        const user = request.user as SessionUser;
        const { city, country } = await profiles.get(user.id);
        const none = { place: null, today: null, days: [] };
        if (!city) return { status: "no-city", ...none };
        if (!weather) return { status: "unavailable", ...none };
        let week;
        try {
          week = await weather.week({ city, country }, request.query.lang);
        } catch (cause) {
          request.log.warn({ err: cause }, "the weather didn't answer");
          return { status: "unavailable", ...none };
        }
        if (!week) return { status: "not-found", ...none };
        const worn = new Set(
          await outfits.woreDays(user.id, new Date(`${week.days[0]!.date}T00:00:00Z`)),
        );
        return {
          status: "ok",
          place: week.place,
          today: week.today,
          days: week.days.map((day) => ({ ...day, wore: worn.has(day.date) })),
        };
      },
    );
  };
