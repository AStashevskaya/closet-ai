import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { buildApp } from "./app";
import { createAuth } from "./auth/auth";
import { loadEnv } from "./config/env";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { createItemsRepository } from "./modules/items/items.repository";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const auth = createAuth(env, drizzleAdapter(db, { provider: "pg", schema }));
const app = await buildApp({ env, auth, itemsRepository: createItemsRepository(db) });

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.HOST, port: env.PORT });
