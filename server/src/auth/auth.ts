import { expo } from "@better-auth/expo";
import { betterAuth, type DBAdapterInstance } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Env } from "../config/env";

// Must match `scheme` in client/app.json.
const APP_SCHEME = "closetai://";

type Options = {
  // Runs once a user has deleted their account: removes what the database cascade can't
  // reach (their photos in storage).
  onUserDeleted?: (userId: string) => Promise<void>;
};

// The storage adapter is passed in: Drizzle in the app, the in-memory adapter in tests.
export function createAuth(env: Env, database: DBAdapterInstance, options: Options = {}) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    database,
    emailAndPassword: { enabled: true },
    // Deleting the account is required by the App Store. POST /api/auth/delete-user with the
    // password; the database removes everything of theirs with the user row (ON DELETE CASCADE).
    user: {
      // The version of the privacy policy accepted at sign-up; the row's createdAt says when.
      // Empty only for accounts older than the consent (2026-11-05). Never changes afterwards.
      additionalFields: {
        privacyConsent: { type: "string", required: false, input: true },
      },
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          await options.onUserDeleted?.(user.id);
        },
      },
    },
    // No account without consent: photos go to services abroad (docs/legal/privacy-policy.md).
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const consent: unknown = (ctx.body as { privacyConsent?: unknown } | undefined)
          ?.privacyConsent;
        // A record of what was accepted at sign-up: input is on for sign-up only.
        if (ctx.path === "/update-user" && consent !== undefined) {
          throw new APIError("BAD_REQUEST", {
            code: "CONSENT_READ_ONLY",
            message: "The accepted privacy policy can't be changed",
          });
        }
        if (ctx.path !== "/sign-up/email") return;
        if (typeof consent !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(consent)) {
          throw new APIError("BAD_REQUEST", {
            code: "CONSENT_REQUIRED",
            message: "Accepting the privacy policy is required",
          });
        }
      }),
    },
    plugins: [expo()],
    trustedOrigins: [
      APP_SCHEME,
      // Expo Go opens the app under exp:// URLs; never trust them outside development.
      ...(env.NODE_ENV === "development" ? ["exp://", "exp://**"] : []),
    ],
    // Better Auth silently skips the origin check when NODE_ENV is "test".
    // Setting it explicitly keeps tests checking what production does.
    advanced: { disableOriginCheck: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
