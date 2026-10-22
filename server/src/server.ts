import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { loadEnv } from "./config/env";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { createUsageRepository } from "./modules/usage/usage.repository";
import { createItemsRepository } from "./modules/items/items.repository";
import { createOutfitsRepository } from "./modules/outfits/outfits.repository";
import { createPhotosRepository } from "./modules/photos/photos.repository";
import { createOutfitQueue } from "./queue/outfit-queue";
import { createPhotoQueue } from "./queue/photo-queue";
import { createS3Storage } from "./storage/storage";
import { startWorkers } from "./workers";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const auth = createAuth(env, drizzleAdapter(db, { provider: "pg", schema }));
const s3 = createS3Storage(env);
// Local SeaweedFS starts without the bucket; in production it is created once in the R2 dashboard.
if (env.NODE_ENV === "development") await s3.ensureBucket();
const photosRepository = createPhotosRepository(db);
const outfitsRepository = createOutfitsRepository(db);
// The API only adds jobs; the workers run them, here or in their own process (src/worker.ts).
const queue = createPhotoQueue(env.REDIS_URL);
const outfitQueue = createOutfitQueue(env.REDIS_URL);
const workers = env.WORKERS_IN_API ? await startWorkers(env, db, s3.storage) : null;
const app = await buildApp({
  env,
  auth,
  itemsRepository: createItemsRepository(db),
  photosRepository,
  usageRepository: createUsageRepository(db),
  outfitsRepository,
  photoQueue: queue.photoQueue,
  outfitQueue: outfitQueue.outfitQueue,
  storage: s3.storage,
  taggingEnabled: env.ANTHROPIC_API_KEY !== undefined,
  stylistEnabled: env.ANTHROPIC_API_KEY !== undefined,
});
if (!env.WORKERS_IN_API) app.log.info("workers run in their own process (src/worker.ts)");
if (!env.ANTHROPIC_API_KEY) app.log.warn("ANTHROPIC_API_KEY is not set: photos will not be tagged");
if (!env.FAL_KEY) app.log.warn("FAL_KEY is not set: photo backgrounds will not be removed");

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  // Lets a job in progress finish before the connections go away.
  await workers?.close();
  await queue.close();
  await outfitQueue.close();
  await close();
  s3.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
