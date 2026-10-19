// Queues a cutout job for every ready photo that has no cut-out yet: photos uploaded before
// background removal existed, or whose cutout job gave up. The running server's worker cuts
// them out and then re-embeds them from the cut-out. About $0.0005 a photo on fal.ai.
// Usage: pnpm --filter @closet-ai/server cutouts:backfill
import { loadEnv } from "../config/env";
import { createDb } from "../db/client";
import { createPhotosRepository } from "../modules/photos/photos.repository";
import { createPhotoQueue } from "../queue/photo-queue";

const env = loadEnv();
if (!env.FAL_KEY) {
  console.error("FAL_KEY is not set in server/.env: the worker would skip every photo.");
  process.exit(1);
}
const { db, close } = createDb(env.DATABASE_URL);
const queue = createPhotoQueue(env.REDIS_URL);

const keys = await createPhotosRepository(db).listWithoutCutout();
for (const key of keys) await queue.photoQueue.enqueueCutout(key);
console.log(`Queued ${keys.length} photo(s) for background removal.`);

await queue.close();
await close();
