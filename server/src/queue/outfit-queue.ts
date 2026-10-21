import type { AppLanguage } from "@closet-ai/shared";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import {
  checkBrief,
  composeOutfits,
  PermanentOutfitError,
  refreshBrief,
  type OutfitJobDeps,
  type OutfitQueue,
} from "../modules/outfits/outfit-jobs";

// Its own queue, apart from photo processing: outfits wait on a model call, not on images.
const QUEUE_NAME = "outfits";

type JobName = "compose" | "brief" | "brief-check";
type JobData = { requestId: string; lang: AppLanguage } | { userId: string };

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

const connectionFor = (redisUrl: string) => ({ url: redisUrl, maxRetriesPerRequest: null });

export function createOutfitQueue(redisUrl: string) {
  const queue = new Queue<JobData, unknown, JobName>(QUEUE_NAME, {
    connection: connectionFor(redisUrl),
  });

  const outfitQueue: OutfitQueue = {
    async enqueueComposing(requestId, lang) {
      // Five tries (2 + 4 + 8 + 16 s apart): an item saved a moment ago may still have its photo processing.
      await queue.add(
        "compose",
        { requestId, lang },
        { ...JOB_OPTIONS, attempts: 5, jobId: `compose-${requestId}` },
      );
    },
    // One waiting brief job per user at a time: the job id dedupes repeated requests.
    async enqueueBrief(userId, delayMs = 0) {
      await queue.add(
        "brief",
        { userId },
        { ...JOB_OPTIONS, delay: delayMs, jobId: `brief-${userId}` },
      );
    },
    async enqueueBriefCheck(userId, delayMs) {
      await queue.add(
        "brief-check",
        { userId },
        { ...JOB_OPTIONS, delay: delayMs, jobId: `brief-check-${userId}-${Date.now()}` },
      );
    },
  };

  return { outfitQueue, close: () => queue.close() };
}

export function createOutfitWorker(redisUrl: string, deps: OutfitJobDeps) {
  const worker = new Worker<JobData, unknown, JobName>(
    QUEUE_NAME,
    async (job) => {
      try {
        if (job.name === "compose") {
          const { requestId, lang } = job.data as { requestId: string; lang: AppLanguage };
          await composeOutfits(deps, requestId, lang);
        } else if (job.name === "brief") {
          await refreshBrief(deps, (job.data as { userId: string }).userId);
        } else {
          await checkBrief(deps, (job.data as { userId: string }).userId);
        }
      } catch (error) {
        if (error instanceof PermanentOutfitError) {
          if (job.name === "compose") {
            await deps.outfits.markFailed((job.data as { requestId: string }).requestId);
          }
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    },
    { connection: connectionFor(redisUrl), concurrency: 4 },
  );

  // A request whose retries ran out stops the app from waiting.
  worker.on("failed", (job) => {
    if (job?.name === "compose" && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void deps.outfits.markFailed((job.data as { requestId: string }).requestId);
    }
  });

  return worker;
}
