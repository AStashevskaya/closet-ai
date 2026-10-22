import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createFalBackgroundRemover } from "./ai/background-remover";
import { createFashionSiglipEmbedder } from "./ai/item-embedder";
import { createClaudeItemTagger } from "./ai/item-tagger";
import { createClaudeStylist } from "./ai/stylist";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { loadEnv } from "./config/env";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { createUsageRepository } from "./modules/usage/usage.repository";
import { createItemsRepository } from "./modules/items/items.repository";
import { createOutfitsRepository } from "./modules/outfits/outfits.repository";
import { createPhotosRepository } from "./modules/photos/photos.repository";
import { createProfileRepository } from "./modules/profile/profile.repository";
import { createOutfitQueue, createOutfitWorker } from "./queue/outfit-queue";
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
// The model loads on the first embed job; the first run downloads it into MODEL_CACHE_DIR.
const embedder = createFashionSiglipEmbedder(env.MODEL_CACHE_DIR);
const remover = env.FAL_KEY ? createFalBackgroundRemover(env.FAL_KEY) : null;
const worker = createPhotoWorker(env.REDIS_URL, {
  photos: photosRepository,
  storage: s3.storage,
  tagger,
  embedder,
  remover,
  queue: queue.photoQueue,
});
await queue.scheduleCleanup();
const outfitsRepository = createOutfitsRepository(db);
const outfitQueue = createOutfitQueue(env.REDIS_URL);
const stylist = env.ANTHROPIC_API_KEY ? createClaudeStylist(env.ANTHROPIC_API_KEY) : null;
const outfitWorker = createOutfitWorker(env.REDIS_URL, {
  outfits: outfitsRepository,
  photos: photosRepository,
  storage: s3.storage,
  remover,
  embedder,
  stylist,
  queue: outfitQueue.outfitQueue,
});
const app = await buildApp({
  env,
  auth,
  itemsRepository: createItemsRepository(db),
  photosRepository,
  usageRepository: createUsageRepository(db),
  outfitsRepository,
  profileRepository: createProfileRepository(db),
  photoQueue: queue.photoQueue,
  outfitQueue: outfitQueue.outfitQueue,
  storage: s3.storage,
  taggingEnabled: tagger !== null,
  stylistEnabled: stylist !== null,
});
if (!tagger) app.log.warn("ANTHROPIC_API_KEY is not set: photos will not be tagged");
if (!env.FAL_KEY) app.log.warn("FAL_KEY is not set: photo backgrounds will not be removed");

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  // Lets a job in progress finish before the connections go away.
  await worker.close();
  await outfitWorker.close();
  await queue.close();
  await outfitQueue.close();
  await close();
  s3.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
