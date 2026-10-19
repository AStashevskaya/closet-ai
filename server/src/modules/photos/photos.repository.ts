import type { ItemTags, PhotoStatus, TagStatus } from "@closet-ai/shared";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items, photos } from "../../db/schema";

export interface Photo {
  key: string;
  ownerId: string;
  uploadKey: string | null;
  status: PhotoStatus;
  tagStatus: TagStatus | null;
  tags: ItemTags | null;
  cutoutKey: string | null;
}

export interface PhotosRepository {
  // tagStatus "pending" when the photo will be tagged, null when tagging is off.
  create(photo: {
    key: string;
    ownerId: string;
    uploadKey: string;
    tagStatus: "pending" | null;
  }): Promise<void>;
  get(key: string): Promise<Photo | null>;
  // The processed WebP is stored and the original deleted.
  markReady(key: string): Promise<void>;
  markFailed(key: string): Promise<void>;
  setTags(key: string, tags: ItemTags): Promise<void>;
  setEmbedding(key: string, embedding: number[]): Promise<void>;
  setCutout(key: string, cutoutKey: string): Promise<void>;
  // Ready photos with no cut-out yet: what the cut-out backfill script queues.
  listWithoutCutout(): Promise<string[]>;
  // Ready photos that have no embedding yet: what the backfill script queues.
  listWithoutEmbedding(): Promise<string[]>;
  markTagsFailed(key: string): Promise<void>;
  // Photos created before `before` that no item points to.
  listUnattached(before: Date): Promise<Photo[]>;
  delete(key: string): Promise<void>;
}

export function createPhotosRepository(db: Db): PhotosRepository {
  const columns = {
    key: photos.key,
    ownerId: photos.ownerId,
    uploadKey: photos.uploadKey,
    status: photos.status,
    tagStatus: photos.tagStatus,
    tags: photos.tags,
    cutoutKey: photos.cutoutKey,
  };

  return {
    async create(photo) {
      await db.insert(photos).values(photo);
    },

    async get(key) {
      const [row] = await db.select(columns).from(photos).where(eq(photos.key, key));
      return row ?? null;
    },

    async markReady(key) {
      await db.update(photos).set({ status: "ready", uploadKey: null }).where(eq(photos.key, key));
    },

    async markFailed(key) {
      await db.update(photos).set({ status: "failed" }).where(eq(photos.key, key));
    },

    async setTags(key, tags) {
      await db.update(photos).set({ tagStatus: "done", tags }).where(eq(photos.key, key));
    },

    async setEmbedding(key, embedding) {
      await db.update(photos).set({ embedding }).where(eq(photos.key, key));
    },

    async setCutout(key, cutoutKey) {
      await db.update(photos).set({ cutoutKey }).where(eq(photos.key, key));
    },

    async listWithoutCutout() {
      const rows = await db
        .select({ key: photos.key })
        .from(photos)
        .where(and(eq(photos.status, "ready"), isNull(photos.cutoutKey)));
      return rows.map((row) => row.key);
    },

    async listWithoutEmbedding() {
      const rows = await db
        .select({ key: photos.key })
        .from(photos)
        .where(and(eq(photos.status, "ready"), isNull(photos.embedding)));
      return rows.map((row) => row.key);
    },

    async markTagsFailed(key) {
      await db.update(photos).set({ tagStatus: "failed" }).where(eq(photos.key, key));
    },

    listUnattached(before) {
      return db
        .select(columns)
        .from(photos)
        .leftJoin(items, eq(items.photoKey, photos.key))
        .where(and(isNull(items.id), lt(photos.createdAt, before)));
    },

    async delete(key) {
      await db.delete(photos).where(eq(photos.key, key));
    },
  };
}
