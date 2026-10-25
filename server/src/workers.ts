import { createFalBackgroundRemover } from "./ai/background-remover";
import { createFashionSiglipEmbedder } from "./ai/item-embedder";
import { createClaudeItemTagger } from "./ai/item-tagger";
import { createClaudeStylist } from "./ai/stylist";
import type { Env } from "./config/env";
import type { Db } from "./db/client";
import { createCatalogRepository } from "./modules/catalog/catalog.repository";
import { createOutfitsRepository } from "./modules/outfits/outfits.repository";
import { createPhotosRepository } from "./modules/photos/photos.repository";
import { createLimits } from "./modules/usage/limits";
import { createUsageRepository } from "./modules/usage/usage.repository";
import { createOutfitQueue, createOutfitWorker } from "./queue/outfit-queue";
import { createPhotoQueue, createPhotoWorker } from "./queue/photo-queue";
import type { Storage } from "./storage/storage";

// The background jobs: photos (process, tag, cut out, embed, clean up) and outfits (compose,
// brief). They need only Redis, the database and storage, so they run either inside the API
// process (WORKERS_IN_API, the default: one command locally) or on their own (src/worker.ts),
// where the embedding model and image work don't slow down requests.
export async function startWorkers(env: Env, db: Db, storage: Storage) {
  const photosRepository = createPhotosRepository(db);
  const photoQueue = createPhotoQueue(env.REDIS_URL);
  const outfitQueue = createOutfitQueue(env.REDIS_URL);
  const catalog = env.PARTNER_ITEMS ? createCatalogRepository(db) : null;
  const tagger = env.ANTHROPIC_API_KEY ? createClaudeItemTagger(env.ANTHROPIC_API_KEY) : null;
  // The model loads on the first embed job; the first run downloads it into MODEL_CACHE_DIR.
  const embedder = createFashionSiglipEmbedder(env.MODEL_CACHE_DIR);
  const remover = env.FAL_KEY ? createFalBackgroundRemover(env.FAL_KEY) : null;
  const stylist = env.ANTHROPIC_API_KEY ? createClaudeStylist(env.ANTHROPIC_API_KEY) : null;

  const photoWorker = createPhotoWorker(env.REDIS_URL, {
    photos: photosRepository,
    storage,
    tagger,
    embedder,
    remover,
    catalog,
    queue: photoQueue.photoQueue,
  });
  await photoQueue.scheduleCleanup();
  const outfitWorker = createOutfitWorker(env.REDIS_URL, {
    outfits: createOutfitsRepository(db),
    photos: photosRepository,
    storage,
    remover,
    embedder,
    stylist,
    catalog,
    queue: outfitQueue.outfitQueue,
    limits: createLimits(createUsageRepository(db), {
      dailyUsd: env.AI_DAILY_BUDGET_USD,
      userMonthlyUsd: env.USER_MONTHLY_BUDGET_USD,
    }),
  });

  return {
    // Lets a job in progress finish before the connections go away.
    async close() {
      await photoWorker.close();
      await outfitWorker.close();
      await photoQueue.close();
      await outfitQueue.close();
    },
  };
}
