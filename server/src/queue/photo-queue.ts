import { Queue, UnrecoverableError, Worker } from "bullmq";
import {
  deleteUnattachedPhotos,
  PermanentPhotoError,
  processUploadedPhoto,
  type PhotoJobDeps,
} from "../modules/photos/photo-jobs";

const QUEUE_NAME = "photos";

type JobData = { name: "process"; data: { key: string } } | { name: "cleanup"; data: object };

// What the API needs from the queue; tests swap in a fake.
export interface PhotoQueue {
  enqueueProcessing(key: string): Promise<void>;
}

// Same photo, same job id: a double request doesn't process it twice.
// BullMQ refuses custom ids with ":" (it uses it in its Redis keys), and storage keys have "/".
export const processJobId = (key: string) => `process-${key.replaceAll(/[/:]/g, "_")}`;

// BullMQ needs maxRetriesPerRequest: null so a Redis hiccup pauses the worker instead of failing jobs.
const connectionFor = (redisUrl: string) => ({ url: redisUrl, maxRetriesPerRequest: null });

export function createPhotoQueue(redisUrl: string) {
  const queue = new Queue(QUEUE_NAME, { connection: connectionFor(redisUrl) });

  const photoQueue: PhotoQueue = {
    async enqueueProcessing(key) {
      await queue.add(
        "process",
        { key },
        {
          jobId: processJobId(key),
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    },
  };

  // Runs the cleanup every hour. Upserting is idempotent, so every worker start can call it.
  async function scheduleCleanup() {
    await queue.upsertJobScheduler("cleanup", { every: 60 * 60 * 1000 }, { name: "cleanup" });
  }

  return { photoQueue, scheduleCleanup, close: () => queue.close() };
}

export function createPhotoWorker(redisUrl: string, deps: PhotoJobDeps) {
  const worker = new Worker<JobData["data"], unknown, JobData["name"]>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "cleanup") return deleteUnattachedPhotos(deps);

      const { key } = job.data as { key: string };
      try {
        await processUploadedPhoto(deps, key);
      } catch (error) {
        // No point retrying a file that isn't an image.
        if (error instanceof PermanentPhotoError) {
          await deps.photos.markFailed(key);
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    },
    { connection: connectionFor(redisUrl), concurrency: 4 },
  );

  // After the last retry the photo is marked failed, so the app stops waiting for it.
  worker.on("failed", (job) => {
    if (job?.name === "process" && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void deps.photos.markFailed((job.data as { key: string }).key);
    }
  });

  return worker;
}
