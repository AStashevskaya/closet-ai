import type { CreateItemInput, Item, PhotoStatus } from "@closet-ai/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items, photos } from "../../db/schema";

// Every method takes the owner, so one user can never read or write another user's items.
export interface ItemsRepository {
  list(ownerId: string): Promise<Item[]>;
  // null when the item doesn't exist or belongs to someone else.
  get(ownerId: string, itemId: string): Promise<Item | null>;
  create(ownerId: string, input: CreateItemInput): Promise<Item>;
  // null when the item doesn't exist, belongs to someone else, or has no photo.
  photoKey(ownerId: string, itemId: string): Promise<string | null>;
  // null when there was nothing to delete (no such item, or someone else's).
  // Otherwise the deleted item's photo key, so the caller can remove the file too.
  delete(ownerId: string, itemId: string): Promise<{ photoKey: string | null } | null>;
}

// Photos are served by the API (it checks the session), so items carry a path, not a storage URL.
export const photoPath = (itemId: string) => `/api/items/${itemId}/photo`;

type ItemRow = typeof items.$inferSelect;

// The photo URL only appears once the worker has stored the WebP; until then the app
// shows a placeholder and polls while photoStatus is "processing".
export function toItem(row: ItemRow, photoStatus: PhotoStatus | null): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    colors: row.colors,
    seasons: row.seasons,
    photoUrl: photoStatus === "ready" ? photoPath(row.id) : undefined,
    photoStatus: photoStatus ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createItemsRepository(db: Db): ItemsRepository {
  return {
    async list(ownerId) {
      const rows = await db
        .select({ item: items, photoStatus: photos.status })
        .from(items)
        .leftJoin(photos, eq(photos.key, items.photoKey))
        .where(eq(items.ownerId, ownerId))
        .orderBy(desc(items.createdAt));
      return rows.map((row) => toItem(row.item, row.photoStatus));
    },

    async get(ownerId, itemId) {
      const [row] = await db
        .select({ item: items, photoStatus: photos.status })
        .from(items)
        .leftJoin(photos, eq(photos.key, items.photoKey))
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
      return row ? toItem(row.item, row.photoStatus) : null;
    },

    async create(ownerId, input) {
      const [row] = await db
        .insert(items)
        .values({ ...input, ownerId })
        .returning();
      if (!row) throw new Error("Insert returned no rows");
      const [photo] = row.photoKey
        ? await db
            .select({ status: photos.status })
            .from(photos)
            .where(eq(photos.key, row.photoKey))
        : [];
      return toItem(row, photo?.status ?? null);
    },

    async photoKey(ownerId, itemId) {
      const [row] = await db
        .select({ photoKey: items.photoKey })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
      return row?.photoKey ?? null;
    },

    async delete(ownerId, itemId) {
      const [row] = await db
        .delete(items)
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)))
        .returning({ photoKey: items.photoKey });
      return row ?? null;
    },
  };
}
