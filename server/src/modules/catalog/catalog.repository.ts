import type { AppLanguage, CatalogEvent, CatalogItem, ItemCategory } from "@closet-ai/shared";
import { and, cosineDistance, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { catalogEvents, catalogItems, items, photos } from "../../db/schema";
import { keyVersion } from "../items/items.repository";

export type CatalogRow = typeof catalogItems.$inferSelect;
export type NewCatalogItem = Omit<CatalogRow, "id" | "createdAt" | "updatedAt">;
export type OfferCandidateRow = CatalogRow & { similarity: number; textSimilarity: number };

// offer-ranker's kindOf in SQL: the last English word of 3+ letters, short words after it
// skipped ("Bag XL" is a bag), a final "s" dropped. Kept in step with kindOf by a Postgres test.
const nameKind = sql<string>`regexp_replace(
  substring(lower(coalesce(${catalogItems.names} ->> 'en', '')) from '([a-z]{3,})(?:[^a-z]+[a-z]{1,2})*[^a-z]*$'),
  's$', '')`;

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
  // The pool "Recreate the look" ranks offers from (offer-ranker.ts): the byImage in-stock items
  // of the category closest to the image embedding, plus up to byKind more of the same kind by
  // English name (kindOf), closest first after them. Each with its cosine to the image and to
  // the text embedding of the piece's description.
  offerCandidates(query: {
    category: ItemCategory;
    image: number[];
    text: number[];
    kind: string;
    byImage: number;
    byKind: number;
  }): Promise<OfferCandidateRow[]>;
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

    async offerCandidates({ category, image, text, kind, byImage, byKind }) {
      const distance = cosineDistance(catalogItems.embedding, image);
      const textDistance = cosineDistance(catalogItems.embedding, text);
      const select = { row: catalogItems, distance, textDistance };
      const inCategory = and(
        eq(catalogItems.category, category),
        eq(catalogItems.inStock, true),
        isNotNull(catalogItems.embedding),
      );
      // Two queries rather than one with a window: both can use the HNSW index like closest().
      // The second asks for byImage + byKind of the kind, so byKind are left after dropping
      // those already in the first. (Today's catalog is small enough for an exact scan; once
      // the planner picks the index, a filtered scan can come back short, and pgvector 0.8's
      // hnsw.iterative_scan is the fix, for closest() too.)
      const [closest, ofKind] = await Promise.all([
        db.select(select).from(catalogItems).where(inCategory).orderBy(distance).limit(byImage),
        kind
          ? db
              .select(select)
              .from(catalogItems)
              .where(and(inCategory, eq(nameKind, kind)))
              .orderBy(distance)
              .limit(byImage + byKind)
          : [],
      ]);
      const ids = new Set(closest.map(({ row }) => row.id));
      return [...closest, ...ofKind.filter(({ row }) => !ids.has(row.id)).slice(0, byKind)].map(
        ({ row, distance: d, textDistance: t }) => ({
          ...row,
          similarity: 1 - Number(d),
          textSimilarity: 1 - Number(t),
        }),
      );
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
