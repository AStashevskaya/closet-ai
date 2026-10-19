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

// processing: uploaded, waiting for the worker; ready: shrunk WebP stored; failed: could not be processed.
export const PHOTO_STATUSES = ["processing", "ready", "failed"] as const;
export const photoStatus = z.enum(PHOTO_STATUSES);
export type PhotoStatus = z.infer<typeof photoStatus>;

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
  // API path of the photo, relative to the server (needs the session cookie). Set once the photo is ready.
  photoUrl: z.string().optional(),
  photoStatus: photoStatus.optional(),
});
export type Item = z.infer<typeof item>;

// Response of GET /api/items.
export const itemList = z.array(item);

// Response of POST /api/photos: pass photoKey on to POST /api/items. The photo is shrunk in
// the background, so it starts out "processing".
export const uploadedPhoto = z.object({ photoKey: z.string(), status: photoStatus });
export type UploadedPhoto = z.infer<typeof uploadedPhoto>;

// What the vision model reads off an item photo (roadmap step 4). The app pre-fills the
// add-item form with name, category, colors and seasons; the rest describes the item for
// search and matching later. Fields the photo doesn't show are null, never guessed.
export const ITEM_FITS = ["slim", "regular", "relaxed", "oversized"] as const;
export const ITEM_CONDITIONS = ["new", "good", "worn"] as const;
// The languages the app speaks; the suggested name comes back in the user's.
export const APP_LANGUAGES = ["en", "he", "ru"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const itemTags = z.object({
  // false when the photo shows no single clothing item (a person, a room, several items):
  // the app then pre-fills nothing.
  recognized: z.boolean(),
  name: z.string().max(120),
  category: itemCategory,
  colors: z.array(itemColor).max(5),
  // All four for an all-season item, so an empty list only ever means "not tagged".
  seasons: z.array(season),
  fit: z.enum(ITEM_FITS).nullable(),
  length: z.string().max(40).nullable(),
  fabric: z.string().max(60).nullable(),
  style: z.string().max(60).nullable(),
  // Only from a visible logo or label.
  brand: z.string().max(60).nullable(),
  condition: z.enum(ITEM_CONDITIONS).nullable(),
});
export type ItemTags = z.infer<typeof itemTags>;

// pending: queued for the model; done: tags are there; failed: gave up (the form stays as typed).
export const TAG_STATUSES = ["pending", "done", "failed"] as const;
export const tagStatus = z.enum(TAG_STATUSES);
export type TagStatus = z.infer<typeof tagStatus>;

// Response of GET /api/photos/status: the app polls it while the add-item form is open.
export const photoState = z.object({
  status: photoStatus,
  // null when tagging is off (no API key configured).
  tagStatus: tagStatus.nullable(),
  tags: itemTags.nullable(),
});
export type PhotoState = z.infer<typeof photoState>;

// Response of GET /api/items/:id and PATCH /api/items/:id: the item plus what the vision
// model read off its photo (null until tagged, or when tagging is off).
export const itemDetail = item.extend({ tags: itemTags.nullable() });
export type ItemDetail = z.infer<typeof itemDetail>;

// Body of PATCH /api/items/:id: the fields the user can correct on the item screen.
// Only the fields sent are changed.
export const updateItemInput = z
  .object({
    name: createItemInput.shape.name,
    category: itemCategory,
    colors: createItemInput.shape.colors,
    seasons: z.array(season),
  })
  .partial();
export type UpdateItemInput = z.infer<typeof updateItemInput>;
