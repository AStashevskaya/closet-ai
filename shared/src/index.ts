import { z } from "zod";

export const ITEM_CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "accessory"] as const;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

export const itemCategory = z.enum(ITEM_CATEGORIES);
export type ItemCategory = z.infer<typeof itemCategory>;

export const season = z.enum(SEASONS);
export type Season = z.infer<typeof season>;

export const createItemInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: itemCategory,
  colors: z.array(z.string().trim().min(1)).min(1).max(5),
  seasons: z.array(season).default([]),
  imageUrl: z.string().url().optional(),
});
export type CreateItemInput = z.infer<typeof createItemInput>;

export const item = createItemInput.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type Item = z.infer<typeof item>;
