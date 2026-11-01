import {
  CATALOG_EVENTS,
  CURRENCIES,
  BODY_SHAPES,
  DISLIKE_REASONS,
  ITEM_CATEGORIES,
  ITEM_COLORS,
  OUTFIT_REQUEST_STATUSES,
  OUTFIT_MOODS,
  OUTFIT_REACTIONS,
  PHOTO_KINDS,
  PHOTO_STATUSES,
  SEASONS,
  TAG_STATUSES,
  SPEND_ACTIONS,
  type AppLanguage,
  type BuyVerdict,
  type ItemBox,
  type ItemTags,
  type LookItem,
  type LookMatch,
  type MissingPiece,
  type StyleSummary,
} from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import type { ModelTokens } from "../ai/stylist";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
// New values go at the end, as `ALTER TYPE ... ADD VALUE` adds them (0019 added "brief").
export const usageActionEnum = pgEnum("usage_action", SPEND_ACTIONS);
export const currencyEnum = pgEnum("currency", CURRENCIES);
export const bodyShapeEnum = pgEnum("body_shape", BODY_SHAPES);
export const catalogEventEnum = pgEnum("catalog_event", CATALOG_EVENTS);
export const dislikeReasonEnum = pgEnum("dislike_reason", DISLIKE_REASONS);

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
    // Where the cut-out's piece sits in this photo (0..1, without the cut-out's padding), so the
    // app can lay the cut-out over it. Null with no cut-out, and for cut-outs made before it was
    // recorded (they would need the remover again to measure).
    cutoutBox: jsonb("cutout_box").$type<ItemBox>(),
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

// One row per counted AI action (an item photo, a "want" screenshot, a selfie) and per style
// brief written: the free-tier limits count the actions, and the cost adds up to the server's
// daily safety stop and the user's monthly cap.
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    action: usageActionEnum("action").notNull(),
    // In millionths of a dollar (0.6 ¢ = 6000): estimated for actions, real for a brief.
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
  // What the user reads about her style, in each language; written with the brief.
  summary: jsonb("summary").$type<StyleSummary>(),
  // What it was written from, to tell when it is stale.
  itemCount: integer("item_count").notNull().default(0),
  reactionCount: integer("reaction_count").notNull().default(0),
  inspirationCount: integer("inspiration_count").notNull().default(0),
  writtenAt: timestamp("written_at", { withTimezone: true }),
  // The batch writing the next one; null when none is running.
  batchId: text("batch_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  // When she last asked to update it ("great shopping" card); the brief job honours it once.
  askedAt: timestamp("asked_at", { withTimezone: true }),
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
    // The tokens behind that cost (input, cache write, cache read, output); null before 0021.
    tokens: jsonb("tokens").$type<ModelTokens>(),
    // For an item from a photo: whether it's worth buying for her wardrobe; null otherwise.
    verdict: jsonb("verdict").$type<BuyVerdict>(),
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

// A piece of an outfit: the item asked about, a wardrobe item, or a partner catalog item, which
// is always marked sponsored.
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
    // Null when the brand took the item out of the catalog since.
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id, {
      onDelete: "set null",
    }),
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
    // Why a dislike: null for other reactions, or when she didn't say.
    reason: dislikeReasonEnum("reason"),
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

// Partner brands' items, imported from their feeds (`catalog:import`). Not anyone's wardrobe:
// outfits and Want / Can recommend them next to the user's own pieces, labelled as a partner's.
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The feed's own id ("P001"): importing the feed again updates the same rows.
    externalId: text("external_id").notNull(),
    // Plain text until brands sign up through the brand portal and become organizations.
    brand: text("brand").notNull(),
    // The name by app language, as the feed gives it.
    names: jsonb("names").$type<Partial<Record<AppLanguage, string>>>().notNull(),
    category: itemCategoryEnum("category").notNull(),
    colors: itemColorEnum("colors").array().notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: currencyEnum("currency").notNull(),
    url: text("url").notNull(),
    // A WebP with transparency at catalog/<external id>.webp.
    imageKey: text("image_key").notNull(),
    // Of the picture flattened on white, like wardrobe cut-outs, so the two compare.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    inStock: boolean("in_stock").notNull().default(true),
    // The demo catalog's made-up brands (see CatalogItem.demo).
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("catalog_items_external_id_idx").on(table.externalId),
    index("catalog_items_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

// One row per partner item shown, opened or followed. Brands only ever see counts; the user
// is kept to count people rather than views, and goes with their account.
export const catalogEvents = pgTable(
  "catalog_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    event: catalogEventEnum("event").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("catalog_events_item_idx").on(table.catalogItemId, table.event, table.createdAt),
  ],
);

// Pieces the user wants to buy: an item-from-a-photo request saved to her wishes. Answering "no"
// or "bought" deletes the row; "still" moves askAt a week on.
export const wishes = pgTable(
  "wishes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => outfitRequests.id, { onDelete: "cascade" }),
    // When to ask whether she still wants it.
    askAt: timestamp("ask_at", { withTimezone: true }).notNull(),
    // How many times she said she still does: intent, for her and (in aggregate) for brands.
    stillCount: integer("still_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("wishes_request_idx").on(table.requestId),
    index("wishes_user_idx").on(table.userId),
  ],
);
