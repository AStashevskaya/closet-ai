import { z } from "zod";

// The value shipped in .env.example. It is long enough to pass min(32), so it is rejected by name.
const EXAMPLE_SECRET = "change-me-to-a-random-string-of-32-chars-or-more";
const DEV_AUTH_URL = "http://localhost:3000";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.string().url(),
    // Signs session cookies and tokens. Generate with `openssl rand -base64 32`.
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .refine((value) => value !== EXAMPLE_SECRET, {
        message: "still the example value; generate one with `openssl rand -base64 32`",
      }),
    // Public URL of this server, used by Better Auth to build callback URLs.
    BETTER_AUTH_URL: z.string().url().optional(),
    // S3-compatible storage for item photos: SeaweedFS in development, Cloudflare R2 in production.
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    // Redis for the BullMQ job queue (photo processing).
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    // Claude API key for tagging item photos. Without it photos are stored but not tagged.
    ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional(),
    // fal.ai key for removing photo backgrounds (BiRefNet). Without it photos keep their background.
    FAL_KEY: z.string().min(1).optional(),
    // The server's daily safety stop on AI spend, in dollars, estimated from counted actions
    // (src/modules/usage/limits.ts). Past it every counted action answers 429 until midnight UTC.
    AI_DAILY_BUDGET_USD: z.coerce.number().positive().default(3),
    // User ids (comma-separated) with roomier limits for testing, see TESTER_LIMITS.
    TESTER_USER_IDS: z
      .string()
      .default("")
      .transform((ids) =>
        ids
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    // Whether the API process also runs the background jobs. "false" in production, where
    // src/worker.ts runs them in a process of its own.
    WORKERS_IN_API: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // Where the embedding model's weights (~100 MB) are downloaded on first use. Outside git.
    MODEL_CACHE_DIR: z.string().default(".models"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    // In production a missing URL would quietly become localhost, and plain http would
    // send session cookies unencrypted.
    if (!env.BETTER_AUTH_URL?.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_URL"],
        message: "must be set to an https:// URL in production",
      });
    }
  })
  .transform((env) => ({ ...env, BETTER_AUTH_URL: env.BETTER_AUTH_URL ?? DEV_AUTH_URL }));

export type Env = z.output<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv) {
  return envSchema.safeParse(source);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = parseEnv(source);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
