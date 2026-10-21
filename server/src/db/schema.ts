import {
  ITEM_CATEGORIES,
  ITEM_COLORS,
  PHOTO_KINDS,
  PHOTO_STATUSES,
  SEASONS,
  TAG_STATUSES,
  USAGE_ACTIONS,
  type ItemTags,
  type LookItem,
  type LookMatch,
} from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "../ai/embedding-model";
import { user } from "./auth-schema";

export * from "./auth-schema";

export const itemCategoryEnum = pgEnum("item_category", ITEM_CATEGORIES);
export const seasonEnum = pgEnum("season", SEASONS);
export const itemColorEnum = pgEnum("item_color", ITEM_COLORS);
export const photoStatusEnum = pgEnum("photo_status", PHOTO_STATUSES);
export const tagStatusEnum = pgEnum("tag_status", TAG_STATUSES);
export const photoKindEnum = pgEnum("photo_kind", PHOTO_KINDS);
export const usageActionEnum = pgEnum("usage_action", USAGE_ACTIONS);

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
    // A look photo (a selfie, or a "want" screenshot) is never attached to an item itself: the items the user picks from it get
    // photos of their own (crops), and the look is cleaned up like any unattached photo.
    kind: photoKindEnum("kind").notNull().default("item"),
    // What the vision model read off the photo. tagStatus is null when tagging is off
    // (no API key), so the app knows not to wait for tags.
    tagStatus: tagStatusEnum("tag_status"),
    tags: jsonb("tags").$type<ItemTags>(),
    // A look photo's items, found by the same tagging job; null for item photos.
    lookItems: jsonb("look_items").$type<LookItem[]>(),
    // A "want" look's matches in the wardrobe, one per look item; null for other photos.
    matches: jsonb("matches").$type<LookMatch[]>(),
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

// One row per counted AI action (an item photo, a "want" screenshot, a selfie): the free-tier
// limits count these, and the estimated cost adds up to the server's daily safety stop.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: usageActionEnum("action").notNull(),
    // Estimated, in millionths of a dollar (0.6 ¢ = 6000).
    costMicros: integer("cost_micros").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_events_user_action_idx").on(table.userId, table.action, table.createdAt),
    index("usage_events_created_at_idx").on(table.createdAt),
  ],
);
