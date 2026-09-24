import { ITEM_CATEGORIES, SEASONS } from "@closet-ai/shared";
import { sql } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const itemCategoryEnum = pgEnum("item_category", ITEM_CATEGORIES);
export const seasonEnum = pgEnum("season", SEASONS);

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: itemCategoryEnum("category").notNull(),
  colors: text("colors").array().notNull(),
  seasons: seasonEnum("seasons").array().notNull().default(sql`'{}'`),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
