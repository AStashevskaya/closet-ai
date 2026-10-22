import { createHash } from "node:crypto";
import type {
  CreateItemInput,
  Item,
  ItemDetail,
  PhotoStatus,
  SimilarItem,
  UpdateItemInput,
} from "@closet-ai/shared";
import { and, cosineDistance, desc, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../../db/client";
import { items, photos } from "../../db/schema";

// Every method takes the owner, so one user can never read or write another user's items.
export interface ItemsRepository {
  list(ownerId: string): Promise<Item[]>;
  // With its photo's tags. null when the item doesn't exist or belongs to someone else.
  get(ownerId: string, itemId: string): Promise<ItemDetail | null>;
  // Changes only the fields given. null when the item doesn't exist or belongs to someone else.
  update(ownerId: string, itemId: string, patch: UpdateItemInput): Promise<ItemDetail | null>;
  create(ownerId: string, input: CreateItemInput): Promise<Item>;
  // The owner's items of the same category whose photos look most like this one's, closest
  // first. null when the item doesn't exist or belongs to someone else; empty when its photo
  // has no embedding yet.
  similar(ownerId: string, itemId: string, limit: number): Promise<SimilarItem[] | null>;
  // Storage key of the item's photo, or of its cut-out. null when the item doesn't exist,
  // belongs to someone else, or has no such file.
  photoKey(ownerId: string, itemId: string, variant: PhotoVariant): Promise<string | null>;
  // Points the item at another photo of the owner's. false when the item doesn't exist or
  // belongs to someone else.
  setPhotoKey(ownerId: string, itemId: string, photoKey: string): Promise<boolean>;
  // null when there was nothing to delete (no such item, or someone else's).
  // Otherwise the deleted item's photo key, so the caller can remove the file too.
  delete(ownerId: string, itemId: string): Promise<{ photoKey: string | null } | null>;
}

// Photos are served by the API (it checks the session), so items carry a path, not a storage URL.
// `v` comes from the storage key: a turned photo or a redone cut-out gets a new key, hence a new
// URL, so the phone doesn't keep showing the cached old one (photos are served as immutable).
export const keyVersion = (key: string) => createHash("sha1").update(key).digest("hex").slice(0, 8);
export const photoPath = (itemId: string, photoKey: string) =>
  `/api/items/${itemId}/photo?v=${keyVersion(photoKey)}`;
export const cutoutPath = (itemId: string, cutoutKey: string) =>
  `/api/items/${itemId}/photo?variant=cutout&v=${keyVersion(cutoutKey)}`;

export type PhotoVariant = "photo" | "cutout";

// What toItem needs from the item's photo row (left-joined, so its fields may be null).
type PhotoFields = { photoStatus: PhotoStatus | null; cutoutKey: string | null };

type ItemRow = typeof items.$inferSelect;

// Prices travel in main units (350.5) and are stored in cents (35050), so sums stay exact.
export const toMinor = (price: number | null | undefined) =>
  price == null ? null : Math.round(price * 100);

// The item fields the API takes, as table columns: only the ones given, so a PATCH changes
// only what it sends.
export function toColumns(input: UpdateItemInput & { photoKey?: string }) {
  const { price, ...rest } = input;
  return price === undefined ? rest : { ...rest, priceMinor: toMinor(price) };
}

// The photo URL only appears once the worker has stored the WebP; until then the app
// shows a placeholder and polls while photoStatus is "processing". The cut-out URL comes a few
// seconds later, once the background is removed.
export function toItem(row: ItemRow, { photoStatus, cutoutKey }: PhotoFields): Item {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    colors: row.colors,
    seasons: row.seasons,
    brand: row.brand,
    price: row.priceMinor === null ? null : row.priceMinor / 100,
    currency: row.currency,
    photoUrl: photoStatus === "ready" && row.photoKey ? photoPath(row.id, row.photoKey) : undefined,
    cutoutUrl:
      photoStatus === "ready" && row.photoKey && cutoutKey
        ? cutoutPath(row.id, cutoutKey)
        : undefined,
    photoStatus: photoStatus ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

const photoFields = { photoStatus: photos.status, cutoutKey: photos.cutoutKey };

export function createItemsRepository(db: Db): ItemsRepository {
  async function get(ownerId: string, itemId: string): Promise<ItemDetail | null> {
    const [row] = await db
      .select({ item: items, ...photoFields, tags: photos.tags })
      .from(items)
      .leftJoin(photos, eq(photos.key, items.photoKey))
      .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
    return row ? { ...toItem(row.item, row), tags: row.tags ?? null } : null;
  }

  return {
    async list(ownerId) {
      const rows = await db
        .select({ item: items, ...photoFields })
        .from(items)
        .leftJoin(photos, eq(photos.key, items.photoKey))
        .where(eq(items.ownerId, ownerId))
        .orderBy(desc(items.createdAt));
      return rows.map((row) => toItem(row.item, row));
    },

    get,

    async update(ownerId, itemId, patch) {
      if (Object.keys(patch).length > 0) {
        const updated = await db
          .update(items)
          .set(toColumns(patch))
          .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)))
          .returning({ id: items.id });
        if (updated.length === 0) return null;
      }
      return get(ownerId, itemId);
    },

    async create(ownerId, input) {
      const [row] = await db
        .insert(items)
        .values({
          ...toColumns(input),
          name: input.name,
          category: input.category,
          colors: input.colors,
          ownerId,
        })
        .returning();
      if (!row) throw new Error("Insert returned no rows");
      const [photo] = row.photoKey
        ? await db.select(photoFields).from(photos).where(eq(photos.key, row.photoKey))
        : [];
      return toItem(row, photo ?? { photoStatus: null, cutoutKey: null });
    },

    async similar(ownerId, itemId, limit) {
      const [source] = await db
        .select({ category: items.category, embedding: photos.embedding })
        .from(items)
        .leftJoin(photos, eq(photos.key, items.photoKey))
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
      if (!source) return null;
      if (!source.embedding) return [];

      // Same category only: whole-photo embeddings also see the background, so a t-shirt and
      // shorts shot on the same bed can score close.
      const distance = cosineDistance(photos.embedding, source.embedding);
      const rows = await db
        .select({ item: items, ...photoFields, distance })
        .from(items)
        .innerJoin(photos, eq(photos.key, items.photoKey))
        .where(
          and(
            eq(items.ownerId, ownerId),
            eq(items.category, source.category),
            ne(items.id, itemId),
            isNotNull(photos.embedding),
          ),
        )
        .orderBy(distance)
        .limit(limit);
      return rows.map((row) => ({
        ...toItem(row.item, row),
        similarity: 1 - Number(row.distance),
      }));
    },

    async photoKey(ownerId, itemId, variant) {
      const [row] = await db
        .select({ photoKey: items.photoKey, cutoutKey: photos.cutoutKey })
        .from(items)
        .leftJoin(photos, eq(photos.key, items.photoKey))
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)));
      return (variant === "cutout" ? row?.cutoutKey : row?.photoKey) ?? null;
    },

    async setPhotoKey(ownerId, itemId, photoKey) {
      const updated = await db
        .update(items)
        .set({ photoKey })
        .where(and(eq(items.id, itemId), eq(items.ownerId, ownerId)))
        .returning({ id: items.id });
      return updated.length > 0;
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
