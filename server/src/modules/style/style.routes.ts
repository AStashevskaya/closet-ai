import { APP_LANGUAGES, styleState, type AppLanguage, type StyleState } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import { httpError } from "../../http-error";
import { BRIEF_EVERY_MS, type OutfitQueue } from "../outfits/outfit-jobs";
import type { OutfitsRepository } from "../outfits/outfits.repository";
import { BRIEF_COST_MICROS, type Limits } from "../usage/limits";

// This many new pieces or saved looks since her last brief are worth an update of her style
// (decided 2026-10-25, counted since the brief rather than within a day from 2026-11-08). The
// brief is ~10 ¢, so it's offered rather than written, once a month on the free tier.
export const SHOPPING_ITEMS = 5;
export const SHOPPING_LOOKS = 3;
// The brief job runs right after she asks; if no batch started by then, it declined.
const ASKED_FOR_MS = 10 * 60 * 1000;

// Her style as the stylist reads it (Profile, and the "great shopping" card): GET for the state,
// POST /style/refresh when she taps "update".
export const styleRoutes =
  (
    outfits: OutfitsRepository,
    queue: OutfitQueue,
    limits: Limits,
    auth: Auth,
    stylistEnabled: boolean,
    clock: () => Date = () => new Date(),
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    async function state(userId: string, lang: AppLanguage, now: Date): Promise<StyleState> {
      const brief = await outfits.brief(userId);
      const lastTry = brief?.requestedAt ?? brief?.writtenAt ?? null;
      const asked =
        brief?.askedAt != null &&
        (!lastTry || brief.askedAt > lastTry) &&
        now.getTime() - brief.askedAt.getTime() < ASKED_FOR_MS;
      const updating = brief?.batchId != null || asked;
      const waiting = lastTry !== null && now.getTime() - lastTry.getTime() < BRIEF_EVERY_MS;

      let suggest: StyleState["suggest"] = null;
      // The first brief is written on its own; after that, new pieces since it, offered only
      // when an update could go now (not past her monthly cap or this month's update).
      if (stylistEnabled && brief?.brief && brief.writtenAt && !updating && !waiting) {
        const added = await outfits.addedSince(userId, brief.writtenAt);
        if (
          (added.items >= SHOPPING_ITEMS || added.looks >= SHOPPING_LOOKS) &&
          (await limits.allows(userId, BRIEF_COST_MICROS, now)) &&
          (await limits.allowsBriefUpdate(userId, now))
        ) {
          suggest = added;
        }
      }
      return {
        summary: brief?.summary?.[lang] ?? null,
        writtenAt: brief?.writtenAt?.toISOString() ?? null,
        updating,
        suggest,
      };
    }

    const query = z.object({ lang: z.enum(APP_LANGUAGES).default("en") });

    app.get(
      "/style",
      { schema: { querystring: query, response: { 200: styleState } } },
      async (request) => state((request.user as SessionUser).id, request.query.lang, clock()),
    );

    app.post(
      "/style/refresh",
      { schema: { querystring: query, response: { 202: styleState } } },
      async (request, reply) => {
        const user = request.user as SessionUser;
        if (!stylistEnabled) throw httpError(503, "outfits are off");
        const now = clock();
        const brief = await outfits.brief(user.id);
        // Nothing to update yet: the first brief comes on its own.
        if (!brief?.brief) throw httpError(409, "style:none");
        const current = await state(user.id, request.query.lang, now);
        if (current.updating) throw httpError(409, "style:updating");
        const lastTry = brief.requestedAt ?? brief.writtenAt;
        if (lastTry && now.getTime() - lastTry.getTime() < BRIEF_EVERY_MS) {
          throw httpError(409, "style:wait");
        }
        if (!(await limits.allows(user.id, BRIEF_COST_MICROS, now))) {
          throw httpError(429, "limit:monthly");
        }
        // Only a stale screen gets here: the app stops offering it once the month's is used.
        if (!(await limits.allowsBriefUpdate(user.id, now))) {
          throw httpError(409, "style:month");
        }
        await outfits.askBrief(user.id, now);
        await queue.enqueueBrief(user.id);
        return reply.code(202).send(await state(user.id, request.query.lang, now));
      },
    );
  };
