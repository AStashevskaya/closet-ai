import {
  CURRENCIES,
  BODY_SHAPES,
  ITEM_CATEGORIES,
  ITEM_COLORS,
  OUTFIT_REQUEST_STATUSES,
  OUTFIT_MOODS,
  OUTFIT_REACTIONS,
  PHOTO_KINDS,
  PHOTO_STATUSES,
  SEASONS,
  TAG_STATUSES,
  USAGE_ACTIONS,
  type ItemTags,
  type LookItem,
  type LookMatch,
  type MissingPiece,
} from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
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
export const currencyEnum = pgEnum("currency", CURRENCIES);
export const bodyShapeEnum = pgEnum("body_shape", BODY_SHAPES);

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
    brand: text("brand"),
    // In cents (minor units) of `currency`, so sums stay exact; the API speaks main units.
    priceMinor: integer("price_minor"),
    currency: currencyEnum("currency"),
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

export const outfitRequestStatusEnum = pgEnum("outfit_request_status", OUTFIT_REQUEST_STATUSES);
export const outfitReactionEnum = pgEnum("outfit_reaction", OUTFIT_REACTIONS);
export const outfitMoodEnum = pgEnum("outfit_mood", OUTFIT_MOODS);

// The user's taste in words, written by a strong model from their wardrobe, the looks they
// saved and the outfits they liked; every outfit request reads it. One per user, rewritten when
// it goes stale (see outfit-jobs.ts). Written through the Batch API, so it can be pending.
export const styleBriefs = pgTable("style_briefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // null until the first brief is back.
  brief: text("brief"),
  // What it was written from, to tell when it is stale.
  itemCount: integer("item_count").notNull().default(0),
  reactionCount: integer("reaction_count").notNull().default(0),
  inspirationCount: integer("inspiration_count").notNull().default(0),
  writtenAt: timestamp("written_at", { withTimezone: true }),
  // The batch writing the next one; null when none is running.
  batchId: text("batch_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
});

// One "what do I wear this with?": the item it was asked about and how it went.
export const outfitRequests = pgTable(
  "outfit_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // The wardrobe item asked about, or (for an item from a photo) its crop, stored as a photo
    // of its own that the hourly cleanup leaves alone while a request points to it.
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    heroPhotoKey: text("hero_photo_key").references(() => photos.key, { onDelete: "set null" }),
    // What the cut-out model is asked for ("leather skirt"), from the photo's look items.
    heroNoun: text("hero_noun"),
    // The mood asked for; null for any.
    mood: outfitMoodEnum("mood"),
    status: outfitRequestStatusEnum("status").notNull().default("pending"),
    // The wardrobe size when asked: a repeat for the same item reuses the outfits until it changes.
    wardrobeSize: integer("wardrobe_size").notNull(),
    // What the model call really cost, in millionths of a dollar.
    costMicros: integer("cost_micros"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outfit_requests_user_item_idx").on(table.userId, table.itemId)],
);

export const outfits = pgTable(
  "outfits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => outfitRequests.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    caption: text("caption").notNull(),
    occasion: text("occasion").notNull(),
    why: text("why").notNull(),
    missing: jsonb("missing").$type<MissingPiece>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outfits_request_idx").on(table.requestId)],
);

// A piece of an outfit: the item asked about, a wardrobe item, or (once partners exist) a
// partner catalog item, which is always marked sponsored.
export const outfitPieces = pgTable(
  "outfit_pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outfitId: uuid("outfit_id")
      .notNull()
      .references(() => outfits.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    hero: boolean("hero").notNull().default(false),
    // Null when the item was deleted since: the outfit and its reactions stay.
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    // No catalog table yet; gets its foreign key with it.
    catalogItemId: uuid("catalog_item_id"),
    sponsored: boolean("sponsored").notNull().default(false),
  },
  (table) => [index("outfit_pieces_outfit_idx").on(table.outfitId)],
);

// Every reaction, kept as history: the taste data outfits learn from.
export const outfitReactions = pgTable(
  "outfit_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outfitId: uuid("outfit_id")
      .notNull()
      .references(() => outfits.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reaction: outfitReactionEnum("reaction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("outfit_reactions_outfit_idx").on(table.outfitId)],
);

// What the user tells about themselves (Profile → My details), one row per user, all optional.
export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  // ISO 3166 code, "IL".
  country: text("country"),
  city: text("city"),
  birthYear: integer("birth_year"),
  heightCm: integer("height_cm"),
  bodyShape: bodyShapeEnum("body_shape"),
  sizeTop: text("size_top"),
  sizeBottom: text("size_bottom"),
  sizeShoes: text("size_shoes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
