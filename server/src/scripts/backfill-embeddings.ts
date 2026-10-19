// Queues an embed job for every ready photo that has no embedding yet: photos uploaded before
// embeddings existed, or whose embed job gave up. The running server's worker computes them.
// Usage: pnpm --filter @closet-ai/server embeddings:backfill
import { loadEnv } from "../config/env";
import { createDb } from "../db/client";
import { createPhotosRepository } from "../modules/photos/photos.repository";
import { createPhotoQueue } from "../queue/photo-queue";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const queue = createPhotoQueue(env.REDIS_URL);

const keys = await createPhotosRepository(db).listWithoutEmbedding();
for (const key of keys) await queue.photoQueue.enqueueEmbedding(key);
console.log(`Queued ${keys.length} photo(s) for embedding.`);

await queue.close();
await close();
