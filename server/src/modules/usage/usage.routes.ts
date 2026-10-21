import { usage } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import type { Limits } from "./limits";

// How much of the free tier the user has used: the app shows it next to the counted actions.
export const usageRoutes =
  (limits: Limits, auth: Auth): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));
    app.get("/usage", { schema: { response: { 200: usage } } }, (request) =>
      limits.summary((request.user as SessionUser).id),
    );
  };
