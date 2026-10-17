import { ITEM_CATEGORIES, SEASONS } from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

export const itemCategoryEnum = pgEnum("item_category", ITEM_CATEGORIES);
export const seasonEnum = pgEnum("season", SEASONS);

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
    colors: text("colors").array().notNull(),
    seasons: seasonEnum("seasons")
      .array()
      .notNull()
      .default(sql`'{}'`),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Every items query filters by owner.
  (table) => [index("items_owner_id_idx").on(table.ownerId)],
);
