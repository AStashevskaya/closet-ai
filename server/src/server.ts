import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { loadEnv } from "./config/env";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { createItemsRepository } from "./modules/items/items.repository";
import { createS3Storage } from "./storage/storage";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const auth = createAuth(env, drizzleAdapter(db, { provider: "pg", schema }));
const s3 = createS3Storage(env);
// Local SeaweedFS starts without the bucket; in production it is created once in the R2 dashboard.
if (env.NODE_ENV === "development") await s3.ensureBucket();
const app = await buildApp({
  env,
  auth,
  itemsRepository: createItemsRepository(db),
  storage: s3.storage,
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await close();
  s3.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
