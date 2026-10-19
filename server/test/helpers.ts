import { randomUUID } from "node:crypto";
import type { CreateItemInput } from "@closet-ai/shared";
import type { Env } from "../src/config/env";
import { toItem, type ItemsRepository } from "../src/modules/items/items.repository";
import { processUploadedPhoto, type PhotoJobDeps } from "../src/modules/photos/photo-jobs";
import type { Photo, PhotosRepository } from "../src/modules/photos/photos.repository";
import type { PhotoQueue } from "../src/queue/photo-queue";

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
  REDIS_URL: "redis://localhost:6379",
};

// In-memory stand-ins for the Drizzle repositories. They share state the way the tables do:
// an item's photo status comes from the photos store, and a photo is unattached when no item points to it.
export function createInMemoryRepositories() {
  type ItemRow = { id: string; ownerId: string; input: CreateItemInput; createdAt: Date };
  const itemRows: ItemRow[] = [];
  const photoRows = new Map<string, Photo & { createdAt: Date }>();

  const toApiItem = ({ id, ownerId, input, createdAt }: ItemRow) => {
    const { photoKey = null, seasons = [], ...rest } = input;
    const status = photoKey ? (photoRows.get(photoKey)?.status ?? null) : null;
    return toItem({ ...rest, seasons, id, ownerId, photoKey, createdAt }, status);
  };

  const itemsRepository: ItemsRepository = {
    list: async (ownerId) => itemRows.filter((row) => row.ownerId === ownerId).map(toApiItem),
    create: async (ownerId, input) => {
      const row = { id: randomUUID(), ownerId, input, createdAt: new Date() };
      itemRows.push(row);
      return toApiItem(row);
    },
    get: async (ownerId, itemId) =>
      store.find((row) => row.ownerId === ownerId && row.item.id === itemId)?.item ?? null,
    photoKey: async (ownerId, itemId) =>
      itemRows.find((row) => row.ownerId === ownerId && row.id === itemId)?.input.photoKey ?? null,
    delete: async (ownerId, itemId) => {
      const index = itemRows.findIndex((row) => row.ownerId === ownerId && row.id === itemId);
      if (index === -1) return null;
      const [row] = itemRows.splice(index, 1);
      return { photoKey: row?.input.photoKey ?? null };
    },
  };

  const photosRepository: PhotosRepository = {
    create: async (photo) => {
      photoRows.set(photo.key, { ...photo, status: "processing", createdAt: new Date() });
    },
    get: async (key) => {
      const row = photoRows.get(key);
      return row
        ? { key: row.key, ownerId: row.ownerId, uploadKey: row.uploadKey, status: row.status }
        : null;
    },
    markReady: async (key) => {
      const row = photoRows.get(key);
      if (row) Object.assign(row, { status: "ready", uploadKey: null });
    },
    markFailed: async (key) => {
      const row = photoRows.get(key);
      if (row) row.status = "failed";
    },
    listUnattached: async (before) =>
      [...photoRows.values()].filter(
        (row) =>
          row.createdAt < before && !itemRows.some((item) => item.input.photoKey === row.key),
      ),
    delete: async (key) => {
      photoRows.delete(key);
    },
  };

  return { itemsRepository, photosRepository };
}

// Records queued photos instead of sending them to Redis; runAll plays the worker's part.
export function createManualPhotoQueue() {
  const queued: string[] = [];
  const photoQueue: PhotoQueue = {
    enqueueProcessing: async (key) => {
      queued.push(key);
    },
  };
  async function runAll(deps: PhotoJobDeps) {
    for (let key = queued.shift(); key; key = queued.shift()) await processUploadedPhoto(deps, key);
  }
  return { photoQueue, queued, runAll };
}
