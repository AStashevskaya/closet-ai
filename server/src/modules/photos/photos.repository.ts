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
