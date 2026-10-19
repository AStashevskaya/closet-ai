import { ITEM_CATEGORIES, ITEM_COLORS, PHOTO_STATUSES, SEASONS } from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

export const itemCategoryEnum = pgEnum("item_category", ITEM_CATEGORIES);
export const seasonEnum = pgEnum("season", SEASONS);
export const itemColorEnum = pgEnum("item_color", ITEM_COLORS);
export const photoStatusEnum = pgEnum("photo_status", PHOTO_STATUSES);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("photos_owner_id_idx").on(table.ownerId)],
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
