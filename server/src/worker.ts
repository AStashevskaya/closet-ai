import { loadEnv } from "./config/env";
import { createDb } from "./db/client";
import { createS3Storage } from "./storage/storage";
import { startWorkers } from "./workers";

// The background jobs in a process of their own, next to an API started with
// WORKERS_IN_API=false. Scale it apart from the API: it holds the embedding model in memory
// and does the image work.
const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const s3 = createS3Storage(env);
const workers = await startWorkers(env, db, s3.storage);
console.log("workers started");

async function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  await workers.close();
  await close();
  s3.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
