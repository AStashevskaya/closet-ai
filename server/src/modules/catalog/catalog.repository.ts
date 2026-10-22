import type { AppLanguage, CatalogEvent, CatalogItem, ItemCategory } from "@closet-ai/shared";
import { and, cosineDistance, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { catalogEvents, catalogItems, items, photos } from "../../db/schema";
import { keyVersion } from "../items/items.repository";

export type CatalogRow = typeof catalogItems.$inferSelect;
export type NewCatalogItem = Omit<CatalogRow, "id" | "createdAt" | "updatedAt">;

export interface CatalogRepository {
  get(id: string): Promise<CatalogRow | null>;
  getMany(ids: string[]): Promise<CatalogRow[]>;
  // Adds a feed item, or updates the one imported before under the same external id.
  upsert(item: NewCatalogItem): Promise<void>;
  // In-stock items of the category closest to the embedding, closest first, with the cosine.
  closest(
    category: ItemCategory,
    embedding: number[],
    limit: number,
  ): Promise<(CatalogRow & { similarity: number })[]>;
  // In-stock items (of a category, or all) for the Edit: those closest to the user's wardrobe
  // as a whole first, by the average of its embeddings; in feed order without a wardrobe.
  list(userId: string, category: ItemCategory | null, limit: number): Promise<CatalogRow[]>;
  record(catalogItemIds: string[], userId: string, event: CatalogEvent): Promise<void>;
}

export const catalogPhotoPath = (id: string, imageKey: string) =>
  `/api/catalog/${id}/photo?v=${keyVersion(imageKey)}`;

export function toCatalogItem(row: CatalogRow, lang: AppLanguage): CatalogItem {
  return {
    id: row.id,
    brand: row.brand,
    name: row.names[lang] ?? row.names.en ?? Object.values(row.names)[0] ?? row.brand,
    category: row.category,
    colors: row.colors,
    price: row.priceMinor / 100,
    currency: row.currency,
    url: row.url,
    imageUrl: catalogPhotoPath(row.id, row.imageKey),
    inStock: row.inStock,
    demo: row.demo,
  };
}

export function createCatalogRepository(db: Db): CatalogRepository {
  return {
    async get(id) {
      const [row] = await db.select().from(catalogItems).where(eq(catalogItems.id, id));
      return row ?? null;
    },

    async getMany(ids) {
      if (ids.length === 0) return [];
      return db.select().from(catalogItems).where(inArray(catalogItems.id, ids));
    },

    async upsert(item) {
      await db
        .insert(catalogItems)
        .values(item)
        .onConflictDoUpdate({
          target: catalogItems.externalId,
          set: { ...item, updatedAt: sql`now()` },
        });
    },

    async closest(category, embedding, limit) {
      const distance = cosineDistance(catalogItems.embedding, embedding);
      const rows = await db
        .select({ row: catalogItems, distance })
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.category, category),
            eq(catalogItems.inStock, true),
            isNotNull(catalogItems.embedding),
          ),
        )
        .orderBy(distance)
        .limit(limit);
      return rows.map(({ row, distance: d }) => ({ ...row, similarity: 1 - Number(d) }));
    },

    async list(userId, category, limit) {
      // pgvector averages vectors; the angle to the average is what counts, so it needn't be
      // unit length. null without embedded items: every distance is null and feed order rules.
      const taste = sql`(
        select avg(${photos.embedding}) from ${items}
        join ${photos} on ${photos.key} = ${items.photoKey}
        where ${items.ownerId} = ${userId} and ${photos.embedding} is not null
      )`;
      return db
        .select()
        .from(catalogItems)
        .where(
          and(
            eq(catalogItems.inStock, true),
            category ? eq(catalogItems.category, category) : undefined,
          ),
        )
        .orderBy(sql`${catalogItems.embedding} <=> ${taste} nulls last`, catalogItems.externalId)
        .limit(limit);
    },

    async record(catalogItemIds, userId, event) {
      if (catalogItemIds.length === 0) return;
      await db
        .insert(catalogEvents)
        .values(catalogItemIds.map((catalogItemId) => ({ catalogItemId, userId, event })));
    },
  };
}
