import type {
  AppLanguage,
  ItemTags,
  OutfitMood,
  MissingPiece,
  Outfit,
  OutfitReaction,
  WearWithRequest,
} from "@closet-ai/shared";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  catalogItems,
  items,
  outfitPieces,
  outfitReactions,
  outfitRequests,
  outfits,
  photos,
  styleBriefs,
} from "../../db/schema";
import { toCatalogItem } from "../catalog/catalog.repository";
import { toItem } from "../items/items.repository";

// A wardrobe item with what styling needs: its tags, its picture and its embedding.
export interface StylingItem {
  id: string;
  name: string;
  category: string;
  colors: string[];
  seasons: string[];
  tags: ItemTags | null;
  // The cut-out when there is one, else the photo.
  imageKey: string;
  embedding: number[] | null;
}

export interface OutfitRequestRow {
  id: string;
  userId: string;
  itemId: string | null;
  heroPhotoKey: string | null;
  heroNoun: string | null;
  mood: OutfitMood | null;
  status: WearWithRequest["status"];
  wardrobeSize: number;
  createdAt: Date;
}

export interface NewOutfit {
  caption: string;
  occasion: string;
  why: string;
  missing: MissingPiece | null;
  // itemId is null for the hero when it is an item from a photo, and for a partner piece.
  pieces: {
    hero: boolean;
    itemId: string | null;
    catalogItemId?: string;
    sponsored?: boolean;
  }[];
}

export interface StyleBrief {
  brief: string | null;
  itemCount: number;
  reactionCount: number;
  inspirationCount: number;
  writtenAt: Date | null;
  batchId: string | null;
  requestedAt: Date | null;
}

// An outfit the user reacted to, in words, for the brief.
export interface ReactedOutfit {
  opinion: "like" | "dislike" | null;
  wore: boolean;
  description: string;
}

// Every method that reads a user's data takes the user, like the items repository.
export interface OutfitsRepository {
  // Items with a ready photo, oldest first: their order numbers them for the model.
  wardrobe(userId: string): Promise<StylingItem[]>;
  // How many of them there are, cheaply.
  wardrobeSize(userId: string): Promise<number>;
  // About a wardrobe item, or an item from a photo (its crop's key and English name).
  createRequest(
    userId: string,
    hero: { itemId: string } | { heroPhotoKey: string; heroNoun: string | null },
    wardrobeSize: number,
    mood?: OutfitMood | null,
  ): Promise<string>;
  getRequest(id: string): Promise<OutfitRequestRow | null>;
  // The user's composed requests, newest first.
  history(userId: string, limit: number): Promise<OutfitRequestRow[]>;
  // The latest finished request for this item in this mood, to reuse while nothing changed.
  latestDone(
    userId: string,
    itemId: string,
    mood: OutfitMood | null,
  ): Promise<OutfitRequestRow | null>;
  // Stores the outfits and marks the request done.
  saveOutfits(
    requestId: string,
    userId: string,
    looks: NewOutfit[],
    costMicros: number,
  ): Promise<void>;
  markFailed(requestId: string): Promise<void>;
  // The request's outfits with their items and the user's reactions; null when not theirs.
  // Partner pieces are named in the language asked for.
  view(requestId: string, userId: string, lang: AppLanguage): Promise<WearWithRequest | null>;
  // false when the outfit doesn't exist or is someone else's.
  react(outfitId: string, userId: string, reaction: OutfitReaction): Promise<boolean>;
  // What her last few finished requests used: how many looks each wardrobe piece was in (the
  // item asked about not counted) and the looks' names, so the next ones can be fresher.
  recentlyUsed(
    userId: string,
    requests: number,
  ): Promise<{ pieces: Map<string, number>; captions: string[] }>;
  reactionCount(userId: string): Promise<number>;
  reactedOutfits(userId: string, limit: number): Promise<ReactedOutfit[]>;
  // Storage keys of the looks the user saved (and "want" screenshots still around), newest first.
  inspirationKeys(userId: string, limit: number): Promise<string[]>;
  // Whether a wardrobe item uses this photo (an item from a photo, added to the wardrobe).
  isAttached(photoKey: string): Promise<boolean>;
  brief(userId: string): Promise<StyleBrief | null>;
  setBriefBatch(userId: string, batchId: string | null): Promise<void>;
  saveBrief(
    userId: string,
    brief: string,
    counts: { itemCount: number; reactionCount: number; inspirationCount: number },
  ): Promise<void>;
}

// The current opinion is the latest like / dislike / none; "wore" is counted.
export function summarize(reactions: { reaction: OutfitReaction; createdAt: Date }[]) {
  const sorted = [...reactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const opinions = sorted.filter((r) => r.reaction !== "wore");
  const last = opinions.at(-1)?.reaction;
  return {
    opinion: last === "like" || last === "dislike" ? last : null,
    woreCount: sorted.filter((r) => r.reaction === "wore").length,
  } satisfies Pick<Outfit, "opinion" | "woreCount">;
}

export function createOutfitsRepository(db: Db): OutfitsRepository {
  const requestColumns = {
    id: outfitRequests.id,
    userId: outfitRequests.userId,
    itemId: outfitRequests.itemId,
    heroPhotoKey: outfitRequests.heroPhotoKey,
    heroNoun: outfitRequests.heroNoun,
    mood: outfitRequests.mood,
    status: outfitRequests.status,
    wardrobeSize: outfitRequests.wardrobeSize,
    createdAt: outfitRequests.createdAt,
  };

  return {
    async wardrobe(userId) {
      const rows = await db
        .select({
          item: items,
          tags: photos.tags,
          photoKey: photos.key,
          cutoutKey: photos.cutoutKey,
          embedding: photos.embedding,
        })
        .from(items)
        .innerJoin(photos, eq(photos.key, items.photoKey))
        .where(and(eq(items.ownerId, userId), eq(photos.status, "ready")))
        .orderBy(asc(items.createdAt));
      return rows.map((row) => ({
        id: row.item.id,
        name: row.item.name,
        category: row.item.category,
        colors: row.item.colors,
        seasons: row.item.seasons,
        tags: row.tags ?? null,
        imageKey: row.cutoutKey ?? row.photoKey,
        embedding: row.embedding ?? null,
      }));
    },

    async wardrobeSize(userId) {
      const [row] = await db
        .select({ n: count() })
        .from(items)
        .innerJoin(photos, eq(photos.key, items.photoKey))
        .where(and(eq(items.ownerId, userId), eq(photos.status, "ready")));
      return row?.n ?? 0;
    },

    async createRequest(userId, hero, wardrobeSize, mood = null) {
      const [row] = await db
        .insert(outfitRequests)
        .values({ userId, ...hero, wardrobeSize, mood })
        .returning({ id: outfitRequests.id });
      return row!.id;
    },

    async getRequest(id) {
      const [row] = await db
        .select(requestColumns)
        .from(outfitRequests)
        .where(eq(outfitRequests.id, id));
      return row ?? null;
    },

    async history(userId, limit) {
      return db
        .select(requestColumns)
        .from(outfitRequests)
        .where(and(eq(outfitRequests.userId, userId), eq(outfitRequests.status, "done")))
        .orderBy(desc(outfitRequests.createdAt))
        .limit(limit);
    },

    async latestDone(userId, itemId, mood) {
      const [row] = await db
        .select(requestColumns)
        .from(outfitRequests)
        .where(
          and(
            eq(outfitRequests.userId, userId),
            eq(outfitRequests.itemId, itemId),
            mood ? eq(outfitRequests.mood, mood) : isNull(outfitRequests.mood),
            eq(outfitRequests.status, "done"),
          ),
        )
        .orderBy(desc(outfitRequests.createdAt))
        .limit(1);
      return row ?? null;
    },

    async saveOutfits(requestId, userId, looks, costMicros) {
      await db.transaction(async (tx) => {
        for (const [position, look] of looks.entries()) {
          const [saved] = await tx
            .insert(outfits)
            .values({ requestId, userId, position, ...look })
            .returning({ id: outfits.id });
          if (look.pieces.length > 0) {
            await tx
              .insert(outfitPieces)
              .values(
                look.pieces.map((piece, i) => ({ outfitId: saved!.id, position: i, ...piece })),
              );
          }
        }
        await tx
          .update(outfitRequests)
          .set({ status: "done", costMicros })
          .where(eq(outfitRequests.id, requestId));
      });
    },

    async markFailed(requestId) {
      await db
        .update(outfitRequests)
        .set({ status: "failed" })
        .where(eq(outfitRequests.id, requestId));
    },

    async view(requestId, userId, lang) {
      const [request] = await db
        .select(requestColumns)
        .from(outfitRequests)
        .where(and(eq(outfitRequests.id, requestId), eq(outfitRequests.userId, userId)));
      if (!request) return null;

      const looks = await db
        .select()
        .from(outfits)
        .where(eq(outfits.requestId, requestId))
        .orderBy(asc(outfits.position));
      const ids = looks.map((look) => look.id);
      const [pieces, reactions] = ids.length
        ? await Promise.all([
            db
              .select({
                outfitId: outfitPieces.outfitId,
                position: outfitPieces.position,
                hero: outfitPieces.hero,
                item: items,
                photoStatus: photos.status,
                cutoutKey: photos.cutoutKey,
                catalog: catalogItems,
              })
              .from(outfitPieces)
              .leftJoin(items, eq(items.id, outfitPieces.itemId))
              .leftJoin(photos, eq(photos.key, items.photoKey))
              .leftJoin(catalogItems, eq(catalogItems.id, outfitPieces.catalogItemId))
              .where(inArray(outfitPieces.outfitId, ids))
              .orderBy(asc(outfitPieces.position)),
            db.select().from(outfitReactions).where(inArray(outfitReactions.outfitId, ids)),
          ])
        : [[], []];

      return {
        id: request.id,
        status: request.status,
        // Filled in by the route, which knows the photo.
        addable: null,
        outfits: looks.map((look) => ({
          id: look.id,
          caption: look.caption,
          occasion: look.occasion,
          why: look.why,
          missing: look.missing ?? null,
          pieces: pieces
            .filter((p) => p.outfitId === look.id)
            .map((p) => ({
              hero: p.hero,
              item: p.item
                ? toItem(p.item, {
                    photoStatus: p.photoStatus ?? null,
                    cutoutKey: p.cutoutKey ?? null,
                  })
                : null,
              catalogItem: p.catalog ? toCatalogItem(p.catalog, lang) : null,
            })),
          ...summarize(reactions.filter((r) => r.outfitId === look.id)),
        })),
      };
    },

    async react(outfitId, userId, reaction) {
      const [own] = await db
        .select({ id: outfits.id })
        .from(outfits)
        .where(and(eq(outfits.id, outfitId), eq(outfits.userId, userId)));
      if (!own) return false;
      await db.insert(outfitReactions).values({ outfitId, userId, reaction });
      return true;
    },

    async recentlyUsed(userId, requests) {
      const recent = await db
        .select({ id: outfitRequests.id })
        .from(outfitRequests)
        .where(and(eq(outfitRequests.userId, userId), eq(outfitRequests.status, "done")))
        .orderBy(desc(outfitRequests.createdAt))
        .limit(requests);
      const pieces = new Map<string, number>();
      if (recent.length === 0) return { pieces, captions: [] };
      const ids = recent.map((r) => r.id);
      const [looks, used] = await Promise.all([
        db
          .select({ caption: outfits.caption })
          .from(outfits)
          .where(inArray(outfits.requestId, ids)),
        db
          .select({ itemId: outfitPieces.itemId })
          .from(outfitPieces)
          .innerJoin(outfits, eq(outfits.id, outfitPieces.outfitId))
          .where(and(inArray(outfits.requestId, ids), eq(outfitPieces.hero, false))),
      ]);
      for (const { itemId } of used) {
        if (itemId) pieces.set(itemId, (pieces.get(itemId) ?? 0) + 1);
      }
      return { pieces, captions: looks.map((look) => look.caption) };
    },

    async reactionCount(userId) {
      const [row] = await db
        .select({ n: count() })
        .from(outfitReactions)
        .where(eq(outfitReactions.userId, userId));
      return row?.n ?? 0;
    },

    async reactedOutfits(userId, limit) {
      const reactions = await db
        .select()
        .from(outfitReactions)
        .where(eq(outfitReactions.userId, userId))
        .orderBy(desc(outfitReactions.createdAt));
      const ids = [...new Set(reactions.map((r) => r.outfitId))].slice(0, limit);
      if (ids.length === 0) return [];
      const [looks, pieces] = await Promise.all([
        db.select().from(outfits).where(inArray(outfits.id, ids)),
        db
          .select({ outfitId: outfitPieces.outfitId, name: items.name })
          .from(outfitPieces)
          .innerJoin(items, eq(items.id, outfitPieces.itemId))
          .where(inArray(outfitPieces.outfitId, ids)),
      ]);
      return looks.map((look) => {
        const { opinion, woreCount } = summarize(reactions.filter((r) => r.outfitId === look.id));
        const names = pieces.filter((p) => p.outfitId === look.id).map((p) => p.name);
        return {
          opinion,
          wore: woreCount > 0,
          description: `"${look.caption}": ${names.join(" + ")}`,
        };
      });
    },

    async inspirationKeys(userId, limit) {
      const rows = await db
        .select({ key: photos.key })
        .from(photos)
        .where(
          and(
            eq(photos.ownerId, userId),
            inArray(photos.kind, ["inspiration", "want"]),
            eq(photos.status, "ready"),
          ),
        )
        .orderBy(desc(photos.createdAt))
        .limit(limit);
      return rows.map((row) => row.key);
    },

    async isAttached(photoKey) {
      const [row] = await db
        .select({ id: items.id })
        .from(items)
        .where(eq(items.photoKey, photoKey));
      return row !== undefined;
    },

    async brief(userId) {
      const [row] = await db.select().from(styleBriefs).where(eq(styleBriefs.userId, userId));
      if (!row) return null;
      const { userId: _userId, ...brief } = row;
      return brief;
    },

    async setBriefBatch(userId, batchId) {
      const requestedAt = batchId ? new Date() : null;
      await db
        .insert(styleBriefs)
        .values({ userId, batchId, requestedAt })
        .onConflictDoUpdate({ target: styleBriefs.userId, set: { batchId, requestedAt } });
    },

    async saveBrief(userId, brief, counts) {
      const set = {
        brief,
        ...counts,
        writtenAt: new Date(),
        batchId: null,
        requestedAt: null,
      };
      await db
        .insert(styleBriefs)
        .values({ userId, ...set })
        .onConflictDoUpdate({ target: styleBriefs.userId, set });
    },
  };
}
