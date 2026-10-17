import type { CreateItemInput, Item } from "@closet-ai/shared";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items } from "../../db/schema";

// Every method takes the owner, so one user can never read or write another user's items.
export interface ItemsRepository {
  list(ownerId: string): Promise<Item[]>;
  create(ownerId: string, input: CreateItemInput): Promise<Item>;
}

type ItemRow = typeof items.$inferSelect;

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    colors: row.colors,
    seasons: row.seasons,
    imageUrl: row.imageUrl ?? undefined,
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
  };
}
