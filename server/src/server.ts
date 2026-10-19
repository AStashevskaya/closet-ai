import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createClaudeItemTagger } from "./ai/item-tagger";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { loadEnv } from "./config/env";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { createItemsRepository } from "./modules/items/items.repository";
import { createPhotosRepository } from "./modules/photos/photos.repository";
import { createPhotoQueue, createPhotoWorker } from "./queue/photo-queue";
import { createS3Storage } from "./storage/storage";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const auth = createAuth(env, drizzleAdapter(db, { provider: "pg", schema }));
const s3 = createS3Storage(env);
// Local SeaweedFS starts without the bucket; in production it is created once in the R2 dashboard.
if (env.NODE_ENV === "development") await s3.ensureBucket();
const photosRepository = createPhotosRepository(db);
const queue = createPhotoQueue(env.REDIS_URL);
const tagger = env.ANTHROPIC_API_KEY ? createClaudeItemTagger(env.ANTHROPIC_API_KEY) : null;
// The worker runs in the API process for now: one process to deploy and run locally.
// It only needs Redis, the database and storage, so it can move to its own process when
// photo processing starts competing with requests.
const worker = createPhotoWorker(env.REDIS_URL, {
  photos: photosRepository,
  storage: s3.storage,
  tagger,
  queue: queue.photoQueue,
});
await queue.scheduleCleanup();
const app = await buildApp({
  env,
  auth,
  itemsRepository: createItemsRepository(db),
  photosRepository,
  photoQueue: queue.photoQueue,
  storage: s3.storage,
  taggingEnabled: tagger !== null,
});
if (!tagger) app.log.warn("ANTHROPIC_API_KEY is not set: photos will not be tagged");

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  // Lets a job in progress finish before the connections go away.
  await worker.close();
  await queue.close();
  await close();
  s3.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
