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

// Response of POST /api/photos: pass photoKey on to POST /api/items.
export const uploadedPhoto = z.object({ photoKey: z.string() });
export type UploadedPhoto = z.infer<typeof uploadedPhoto>;
