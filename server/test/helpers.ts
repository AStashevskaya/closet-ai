import { randomUUID } from "node:crypto";
import type { Item } from "@closet-ai/shared";
import type { Env } from "../src/config/env";
import { photoPath, type ItemsRepository } from "../src/modules/items/items.repository";

// Shared by the test files. Not a test file itself (no .test.ts), so Vitest doesn't run it.
export const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:8333",
  S3_REGION: "auto",
  S3_BUCKET: "unused",
  S3_ACCESS_KEY_ID: "unused",
  S3_SECRET_ACCESS_KEY: "unused",
};

export function createInMemoryItemsRepository(): ItemsRepository {
  const store: { item: Item; ownerId: string; photoKey?: string }[] = [];
  return {
    list: async (ownerId) => store.filter((row) => row.ownerId === ownerId).map((row) => row.item),
    create: async (ownerId, { photoKey, ...input }) => {
      const id = randomUUID();
      const item: Item = {
        ...input,
        id,
        createdAt: new Date().toISOString(),
        photoUrl: photoKey ? photoPath(id) : undefined,
      };
      store.push({ item, ownerId, photoKey });
      return item;
    },
    get: async (ownerId, itemId) =>
      store.find((row) => row.ownerId === ownerId && row.item.id === itemId)?.item ?? null,
    photoKey: async (ownerId, itemId) =>
      store.find((row) => row.ownerId === ownerId && row.item.id === itemId)?.photoKey ?? null,
    delete: async (ownerId, itemId) => {
      const index = store.findIndex((row) => row.ownerId === ownerId && row.item.id === itemId);
      if (index === -1) return null;
      const [row] = store.splice(index, 1);
      return { photoKey: row?.photoKey ?? null };
    },
  };
}
