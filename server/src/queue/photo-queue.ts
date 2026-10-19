import type { AppLanguage } from "@closet-ai/shared";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import {
  deleteUnattachedPhotos,
  PermanentPhotoError,
  cutOutPhoto,
  embedPhoto,
  processUploadedPhoto,
  tagPhoto,
  type PhotoJobDeps,
} from "../modules/photos/photo-jobs";

const QUEUE_NAME = "photos";

// The language travels with the jobs: the tagger writes the suggested name in it.
type PhotoJobData = { key: string; lang: AppLanguage };
type JobName = "process" | "tag" | "cutout" | "embed" | "cleanup";

// What the API and the jobs need from the queue; tests swap in a fake.
export interface PhotoQueue {
  enqueueProcessing(key: string, lang: AppLanguage): Promise<void>;
  enqueueTagging(key: string, lang: AppLanguage): Promise<void>;
  enqueueCutout(key: string): Promise<void>;
  enqueueEmbedding(key: string): Promise<void>;
}

// Same photo, same job id: a double request doesn't process or tag it twice.
// BullMQ refuses custom ids with ":" (it uses it in its Redis keys), and storage keys have "/".
const jobId = (name: Exclude<JobName, "cleanup">, key: string) =>
  `${name}-${key.replaceAll(/[/:]/g, "_")}`;
export const processJobId = (key: string) => jobId("process", key);
export const tagJobId = (key: string) => jobId("tag", key);
export const cutoutJobId = (key: string) => jobId("cutout", key);
export const embedJobId = (key: string) => jobId("embed", key);

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

// BullMQ needs maxRetriesPerRequest: null so a Redis hiccup pauses the worker instead of failing jobs.
const connectionFor = (redisUrl: string) => ({ url: redisUrl, maxRetriesPerRequest: null });

export function createPhotoQueue(redisUrl: string) {
  const queue = new Queue<PhotoJobData | object, unknown, JobName>(QUEUE_NAME, {
    connection: connectionFor(redisUrl),
  });

  const photoQueue: PhotoQueue = {
    async enqueueProcessing(key, lang) {
      await queue.add("process", { key, lang }, { ...JOB_OPTIONS, jobId: processJobId(key) });
    },
    async enqueueTagging(key, lang) {
      await queue.add("tag", { key, lang }, { ...JOB_OPTIONS, jobId: tagJobId(key) });
    },
    async enqueueCutout(key) {
      await queue.add("cutout", { key }, { ...JOB_OPTIONS, jobId: cutoutJobId(key) });
    },
    async enqueueEmbedding(key) {
      await queue.add("embed", { key }, { ...JOB_OPTIONS, jobId: embedJobId(key) });
    },
  };

  // Runs the cleanup every hour. Upserting is idempotent, so every worker start can call it.
  async function scheduleCleanup() {
    await queue.upsertJobScheduler("cleanup", { every: 60 * 60 * 1000 }, { name: "cleanup" });
  }

  return { photoQueue, scheduleCleanup, close: () => queue.close() };
}

// What to do when a job gives up for good, so the app stops waiting. A photo without an
// embedding just doesn't show up in "similar": nothing to mark. A photo that couldn't be cut
// out keeps its background and is embedded as it is.
async function markGaveUp(deps: PhotoJobDeps, job: Job<PhotoJobData | object, unknown, JobName>) {
  const { key } = job.data as PhotoJobData;
  if (job.name === "process") await deps.photos.markFailed(key);
  if (job.name === "tag") await deps.photos.markTagsFailed(key);
  if (job.name === "cutout" && deps.embedder) await deps.queue.enqueueEmbedding(key);
}

export function createPhotoWorker(redisUrl: string, deps: PhotoJobDeps) {
  const worker = new Worker<PhotoJobData | object, unknown, JobName>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "cleanup") return deleteUnattachedPhotos(deps);

      const { key, lang } = job.data as PhotoJobData;
      try {
        if (job.name === "process") await processUploadedPhoto(deps, key, lang);
        else if (job.name === "tag") await tagPhoto(deps, key, lang);
        else if (job.name === "cutout") await cutOutPhoto(deps, key);
        else await embedPhoto(deps, key);
      } catch (error) {
        // No point retrying a file that isn't an image, or a photo the model declined.
        if (error instanceof PermanentPhotoError) {
          await markGaveUp(deps, job);
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    },
    { connection: connectionFor(redisUrl), concurrency: 4 },
  );

  // After the last retry the photo (or its tags) is marked failed.
  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void markGaveUp(deps, job);
  });

  return worker;
}
