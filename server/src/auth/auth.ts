import { expo } from "@better-auth/expo";
import { betterAuth, type DBAdapterInstance } from "better-auth";
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
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          await options.onUserDeleted?.(user.id);
        },
      },
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
