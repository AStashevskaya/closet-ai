import { z } from "zod";

export const ITEM_CATEGORIES = ["top", "bottom", "dress", "outerwear", "shoes", "accessory"] as const;
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
// A fixed palette rather than free text, so colors can be picked with chips,
// filtered on and, from step 4, returned by the vision model as structured output.
export const ITEM_COLORS = [
  "black",
  "white",
  "gray",
  "beige",
  "brown",
  "red",
  "pink",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "multicolor",
] as const;

export const itemCategory = z.enum(ITEM_CATEGORIES);
export type ItemCategory = z.infer<typeof itemCategory>;

export const season = z.enum(SEASONS);
export type Season = z.infer<typeof season>;

export const itemColor = z.enum(ITEM_COLORS);
export type ItemColor = z.infer<typeof itemColor>;

export const createItemInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: itemCategory,
  colors: z.array(itemColor).min(1).max(5),
  seasons: z.array(season).default([]),
  // Key returned by POST /api/photos. The server checks it is the caller's own upload.
  photoKey: z.string().max(200).optional(),
});
export type CreateItemInput = z.infer<typeof createItemInput>;

export const item = createItemInput.omit({ photoKey: true }).extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  // API path of the photo, relative to the server (needs the session cookie).
  photoUrl: z.string().optional(),
});
export type Item = z.infer<typeof item>;

// Response of GET /api/items.
export const itemList = z.array(item);

// Response of POST /api/photos: pass photoKey on to POST /api/items.
export const uploadedPhoto = z.object({ photoKey: z.string() });
export type UploadedPhoto = z.infer<typeof uploadedPhoto>;
