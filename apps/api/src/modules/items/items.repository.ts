import type { CreateItemInput, Item } from "@closet-ai/shared";
import { desc } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items } from "../../db/schema";

export interface ItemsRepository {
  list(): Promise<Item[]>;
  create(input: CreateItemInput): Promise<Item>;
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
    async list() {
      const rows = await db.select().from(items).orderBy(desc(items.createdAt));
      return rows.map(toItem);
    },

    async create(input) {
      const [row] = await db.insert(items).values(input).returning();
      if (!row) throw new Error("Insert returned no rows");
      return toItem(row);
    },
  };
}
