import { expo } from "@better-auth/expo";
import { betterAuth, type DBAdapterInstance } from "better-auth";
import type { Env } from "../config/env";

// Must match `scheme` in client/app.json.
const APP_SCHEME = "closetai://";

// The storage adapter is passed in: Drizzle in the app, the in-memory adapter in tests.
export function createAuth(env: Env, database: DBAdapterInstance) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    database,
    emailAndPassword: { enabled: true },
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
