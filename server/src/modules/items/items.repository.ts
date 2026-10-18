import type { CreateItemInput, Item } from "@closet-ai/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items } from "../../db/schema";

// Every method takes the owner, so one user can never read or write another user's items.
export interface ItemsRepository {
  list(ownerId: string): Promise<Item[]>;
  create(ownerId: string, input: CreateItemInput): Promise<Item>;
  // null when the item doesn't exist, belongs to someone else, or has no photo.
  photoKey(ownerId: string, itemId: string): Promise<string | null>;
}

// Photos are served by the API (it checks the session), so items carry a path, not a storage URL.
export const photoPath = (itemId: string) => `/api/items/${itemId}/photo`;

type ItemRow = typeof items.$inferSelect;

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    colors: row.colors,
    seasons: row.seasons,
    photoUrl: row.photoKey ? photoPath(row.id) : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createItemsRepository(db: Db): ItemsRepository {
  return {
    async list(ownerId) {
      const rows = await db
        .select()
        .from(items)
        .where(eq(items.ownerId, ownerId))
        .orderBy(desc(items.createdAt));
      return rows.map(toItem);
    },

    async create(ownerId, input) {
      const [row] = await db
        .insert(items)
        .values({ ...input, ownerId })
        .returning();
      if (!row) throw new Error("Insert returned no rows");
      return toItem(row);
    },

    async photoKey(ownerId, itemId) {
      const [row] = await db
        .select({ photoKey: items.photoKey })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
      return row?.photoKey ?? null;
    },
  };
}
