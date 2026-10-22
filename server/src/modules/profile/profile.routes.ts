import { updateProfileInput, userProfile } from "@closet-ai/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Auth } from "../../auth/auth";
import { requireUser, type SessionUser } from "../../auth/require-user";
import type { ProfileRepository } from "./profile.repository";

// The user's own details, Profile → My details. The name lives on the Better Auth user
// (updated through /api/auth/update-user), not here.
export const profileRoutes =
  (profiles: ProfileRepository, auth: Auth): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook("preHandler", requireUser(auth));

    app.get("/profile", { schema: { response: { 200: userProfile } } }, async (request) =>
      profiles.get((request.user as SessionUser).id),
    );

    app.patch(
      "/profile",
      { schema: { body: updateProfileInput, response: { 200: userProfile } } },
      async (request) => profiles.update((request.user as SessionUser).id, request.body),
    );
  };
