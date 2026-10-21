import { z } from "zod";

export const ITEM_CATEGORIES = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
] as const;
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
  // The same photo with the background removed (transparent WebP). Set a few seconds after
  // photoUrl, or never when background removal is off or failed: show photoUrl until then.
  cutoutUrl: z.string().optional(),
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

// A photo of one item (the add-item form), or of a whole outfit (a mirror selfie): the model
// then lists every item it sees, and the user picks which to add to the wardrobe. "want" is a
// look someone else wears (a Pinterest or Instagram screenshot): its items are matched against
// the wardrobe instead ("Want / Can").
// item: one wardrobe item; look: a selfie to add items from; want: someone else's look to
// match against the wardrobe; wear: a screenshot or photo of an item to style ("what do I wear this with?").
export const PHOTO_KINDS = ["item", "look", "want", "wear"] as const;
export const photoKind = z.enum(PHOTO_KINDS);
export type PhotoKind = z.infer<typeof photoKind>;

// Where an item is in its photo, relative to the image: 0..1 from the left and top edges.
export const itemBox = z.object({
  xMin: z.number().min(0).max(1),
  yMin: z.number().min(0).max(1),
  xMax: z.number().min(0).max(1),
  yMax: z.number().min(0).max(1),
});
export type ItemBox = z.infer<typeof itemBox>;

// One item found on a look photo: its tags and its box.
export const lookItem = itemTags.omit({ recognized: true }).extend({
  box: itemBox,
  // The item's type in English ("leather midi skirt"): what the cut-out model is asked for, so
  // it cuts out the skirt and not the shirt over it. null on looks found before it existed.
  noun: z.string().max(60).nullable().default(null),
});
export type LookItem = z.infer<typeof lookItem>;

// How close the wardrobe comes to an item on a "want" look: the same item, one that can stand
// in for it, or nothing.
export const MATCH_KINDS = ["same", "similar", "none"] as const;
export const matchKind = z.enum(MATCH_KINDS);
export type MatchKind = z.infer<typeof matchKind>;

// What the server stores per found item of a "want" look, in the order of its items.
export const lookMatch = z.object({ how: matchKind, itemId: z.string().uuid().nullable() });
export type LookMatch = z.infer<typeof lookMatch>;

// Response of GET /api/photos/status: the app polls it while the add-item form is open.
export const photoState = z.object({
  status: photoStatus,
  // null when tagging is off (no API key configured).
  tagStatus: tagStatus.nullable(),
  tags: itemTags.nullable(),
  // A look photo's items once found (empty when none); null for item photos and until then.
  lookItems: z.array(lookItem).nullable(),
  // A "want" look's wardrobe matches, one per item in lookItems, with the matched item (null
  // when nothing matches, or the item was deleted since). null for other photos and until then.
  matches: z.array(z.object({ how: matchKind, item: item.nullable() })).nullable(),
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

// Response of GET /api/items/:id/similar: the closest items of the same category in the
// user's wardrobe, most similar first. similarity is the cosine of the photo embeddings (-1..1).
export const similarItem = item.extend({ similarity: z.number() });
export type SimilarItem = z.infer<typeof similarItem>;
export const similarItems = z.array(similarItem);

// Body of POST /api/photos/look-items: which of a look photo's items to add to the wardrobe,
// with the user's corrections. Each becomes an item whose photo is that part of the look.
export const addLookItemsInput = z.object({
  photoKey: z.string().max(200),
  items: z
    .array(
      z.object({
        // Position in the photo's lookItems.
        index: z.number().int().min(0),
        name: createItemInput.shape.name,
        category: itemCategory,
        colors: createItemInput.shape.colors,
        seasons: z.array(season),
      }),
    )
    .min(1)
    .max(12),
});
export type AddLookItemsInput = z.infer<typeof addLookItemsInput>;

// "What do I wear this with?": outfits built around one item, from the user's wardrobe.

export const OUTFIT_REQUEST_STATUSES = ["pending", "done", "failed"] as const;
export const outfitRequestStatus = z.enum(OUTFIT_REQUEST_STATUSES);

// like / dislike are one opinion (the latest wins, "none" takes it back); "wore" is counted
// every time: it is the strongest signal of taste.
export const OUTFIT_REACTIONS = ["like", "dislike", "none", "wore"] as const;
export const outfitReaction = z.enum(OUTFIT_REACTIONS);
export type OutfitReaction = z.infer<typeof outfitReaction>;

// A piece the stylist thinks the look lacks and the user doesn't own, in words a shop search
// can use. Later partner catalog items are found by it.
export const missingPiece = z.object({ category: itemCategory, description: z.string() });
export type MissingPiece = z.infer<typeof missingPiece>;

export const outfitPiece = z.object({
  // The item the outfit is built around.
  hero: z.boolean(),
  // A wardrobe item; null when it was deleted since (or for a partner item, later).
  item: item.nullable(),
});

export const outfit = z.object({
  id: z.string().uuid(),
  caption: z.string(),
  occasion: z.string(),
  why: z.string(),
  missing: missingPiece.nullable(),
  pieces: z.array(outfitPiece),
  opinion: z.enum(["like", "dislike"]).nullable(),
  woreCount: z.number().int(),
});
export type Outfit = z.infer<typeof outfit>;

// A wardrobe item, or one item found on an uploaded "wear" photo (its index in lookItems).
export const wearWithInput = z.union([
  z.object({ itemId: z.string().uuid() }),
  z.object({ photoKey: z.string().max(200), index: z.number().int().min(0) }),
]);
export type WearWithInput = z.infer<typeof wearWithInput>;

// The answer to POST /api/wear-with: the request to poll (an earlier one when it is reused).
export const wearWithStarted = z.object({ id: z.string().uuid() });

export const wearWithRequest = z.object({
  id: z.string().uuid(),
  status: outfitRequestStatus,
  outfits: z.array(outfit),
  // For an item from a photo: what adding it to the wardrobe takes (POST /api/items).
  addable: createItemInput.extend({ photoKey: z.string() }).nullable(),
});
export type WearWithRequest = z.infer<typeof wearWithRequest>;

export const outfitReactionInput = z.object({ reaction: outfitReaction });

export * from "./limits";
