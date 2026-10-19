import {
  ITEM_CATEGORIES,
  ITEM_COLORS,
  PHOTO_STATUSES,
  SEASONS,
  TAG_STATUSES,
  type ItemTags,
} from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../ai/embedding-model";
import { user } from "./auth-schema";

export * from "./auth-schema";

export const itemCategoryEnum = pgEnum("item_category", ITEM_CATEGORIES);
export const seasonEnum = pgEnum("season", SEASONS);
export const itemColorEnum = pgEnum("item_color", ITEM_COLORS);
export const photoStatusEnum = pgEnum("photo_status", PHOTO_STATUSES);
export const tagStatusEnum = pgEnum("tag_status", TAG_STATUSES);

// One row per uploaded photo. The worker turns the original (uploadKey) into the shrunk WebP
// at key; photos never attached to an item are cleaned up after a day.
export const photos = pgTable(
  "photos",
  {
    // Storage key of the processed WebP: photos/<owner id>/<uuid>.webp
    key: text("key").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Storage key of the original upload; null once it has been processed and deleted.
    uploadKey: text("upload_key"),
    status: photoStatusEnum("status").notNull().default("processing"),
    // What the vision model read off the photo. tagStatus is null when tagging is off
    // (no API key), so the app knows not to wait for tags.
    tagStatus: tagStatusEnum("tag_status"),
    tags: jsonb("tags").$type<ItemTags>(),
    // The photo's image embedding (Marqo-FashionSigLIP, normalized), for "find similar".
    // Null until the worker has computed it.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    // Storage key of the item cut out of its background (a WebP with transparency, next to the
    // photo); null until the worker has made it, or when background removal is off.
    cutoutKey: text("cutout_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("photos_owner_id_idx").on(table.ownerId),
    // Cosine distance, as the embeddings are compared by angle. HNSW keeps nearest-neighbour
    // queries fast as wardrobes grow; with a few hundred items Postgres may simply scan.
    index("photos_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Better Auth user ids are text, not uuid.
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: itemCategoryEnum("category").notNull(),
    colors: itemColorEnum("colors").array().notNull(),
    seasons: seasonEnum("seasons")
      .array()
      .notNull()
      .default(sql`'{}'`),
    photoKey: text("photo_key").references(() => photos.key, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Every items query filters by owner.
  (table) => [index("items_owner_id_idx").on(table.ownerId)],
);
