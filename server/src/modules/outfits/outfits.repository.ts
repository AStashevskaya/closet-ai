import type {
  AppLanguage,
  BuyVerdict,
  DislikeReason,
  ItemTags,
  OutfitMood,
  MissingPiece,
  Outfit,
  OutfitReaction,
  StyleSummary,
  WearWithRequest,
} from "@closet-ai/shared";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  DrizzleQueryError,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { pairKey } from "./pair-key";
import type { ModelTokens } from "../../ai/stylist";
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
  wishes,
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
  verdict: BuyVerdict | null;
  createdAt: Date;
  // The day of a look-of-the-day request; null for a styling she asked for.
  dailyOn: string | null;
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
  summary: StyleSummary | null;
  itemCount: number;
  reactionCount: number;
  inspirationCount: number;
  writtenAt: Date | null;
  batchId: string | null;
  requestedAt: Date | null;
  askedAt: Date | null;
}

// An outfit the user reacted to, in words, for the brief.
export interface ReactedOutfit {
  opinion: "like" | "dislike" | null;
  reason: DislikeReason | null;
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
  // Her latest request about this piece in this mood that hasn't failed, done or still at work:
  // asking again gets this one if it still holds, rather than a second, counted one.
  latestAsked(
    userId: string,
    hero: { itemId: string } | { heroPhotoKey: string },
    mood: OutfitMood | null,
  ): Promise<OutfitRequestRow | null>;
  // Stores the outfits (and, for an item from a photo, the verdict) and marks the request done.
  // false when the request is gone: she deleted it while it was being composed.
  saveOutfits(
    requestId: string,
    userId: string,
    looks: NewOutfit[],
    cost: { micros: number; tokens?: ModelTokens },
    verdict?: BuyVerdict | null,
  ): Promise<boolean>;
  markFailed(requestId: string): Promise<void>;
  // Deletes her styling; false when it isn't hers or is already gone. Its wish and every look she
  // never reacted to go. Looks she did react to stay for the brief, on a row with neither piece,
  // the state a deleted item already leaves: out of the diary, and read by nothing else.
  deleteRequest(requestId: string, userId: string): Promise<boolean>;
  // The request's outfits with their items and the user's reactions; null when not theirs.
  // Partner pieces are named in the language asked for.
  view(requestId: string, userId: string, lang: AppLanguage): Promise<WearWithRequest | null>;
  // false when the outfit doesn't exist or is someone else's.
  react(
    outfitId: string,
    userId: string,
    reaction: OutfitReaction,
    reason?: DislikeReason,
  ): Promise<boolean>;
  // What her last few finished requests used: how many looks each wardrobe piece was in (the
  // item asked about not counted) and the looks' names, so the next ones can be fresher.
  recentlyUsed(
    userId: string,
    requests: number,
  ): Promise<{ pieces: Map<string, number>; captions: string[] }>;
  // How many of her outfits she reacted to: toggling a like on one outfit counts once, so taps
  // alone can't make the brief stale.
  reactedOutfitCount(userId: string): Promise<number>;
  reactedOutfits(userId: string, limit: number): Promise<ReactedOutfit[]>;
  // Cuts (or ties back) a piece's string in her look. "hero" for the piece the look is built
  // around, which can't be cut; "missing" when the look or the piece isn't hers.
  strike(
    outfitId: string,
    pieceId: string,
    userId: string,
    struck: boolean,
  ): Promise<"ok" | "hero" | "missing">;
  // Her look-of-the-day request for a day (her city's date), if she has one yet.
  findDailyRequest(userId: string, day: string): Promise<string | null>;
  // That request, made the first time a look is found for the day.
  dailyRequest(userId: string, day: string, wardrobeSize: number): Promise<string>;
  // A look added to her look-of-the-day request (the newest is the day's), only while it still
  // holds `shown` looks: a second request racing this one, or a tap sent twice, adds nothing.
  addDailyLook(requestId: string, userId: string, look: NewOutfit, shown: number): Promise<boolean>;
  // Pairs of her pieces (keys from pairKey) where she cut one out of a look the other was in.
  struckPairs(userId: string, limit: number): Promise<string[]>;
  // The days (YYYY-MM-DD at the given UTC offset, her city's) since `since` on which she marked a
  // look as worn.
  woreDays(userId: string, since: Date, offsetSeconds: number): Promise<string[]>;
  // The look she last said she wore on each day since `since` (days in her city, by
  // `offsetSeconds`), for the week's recap.
  woreLooks(
    userId: string,
    since: Date,
    offsetSeconds: number,
  ): Promise<{ day: string; outfitId: string; requestId: string }[]>;
  // The pieces she cut, newest first, each with the piece its look was built around, by name.
  struckPieces(userId: string, limit: number): Promise<{ hero: string; piece: string }[]>;
  // Storage keys of the looks the user saved (and "want" screenshots still around), newest first.
  inspirationKeys(userId: string, limit: number): Promise<string[]>;
  // Whether a wardrobe item uses this photo (an item from a photo, added to the wardrobe).
  isAttached(photoKey: string): Promise<boolean>;
  // The same for many photos in one query: the ones a wardrobe item uses.
  attachedKeys(photoKeys: string[]): Promise<Set<string>>;
  brief(userId: string): Promise<StyleBrief | null>;
  setBriefBatch(userId: string, batchId: string, requestedAt: Date): Promise<void>;
  // The batch failed or was given up on: `requestedAt` stays, so the next try waits its turn.
  dropBriefBatch(userId: string): Promise<void>;
  saveBrief(
    userId: string,
    written: { brief: string; summary: StyleSummary },
    counts: { itemCount: number; reactionCount: number; inspirationCount: number },
    writtenAt: Date,
  ): Promise<void>;
  // She asked for her style to be updated; null once the job has declined it.
  askBrief(userId: string, askedAt: Date | null): Promise<void>;
  // Wardrobe items (with their photo ready) and saved looks she added since `since`.
  addedSince(userId: string, since: Date): Promise<{ items: number; looks: number }>;
}

// Drizzle wraps the driver's error, which has Postgres's code.
const isForeignKeyViolation = (error: unknown) =>
  error instanceof DrizzleQueryError && (error.cause as { code?: string }).code === "23503";

// The current opinion is the latest like / dislike / none, with a dislike's reason; "wore" is
// counted.
export function summarize(
  reactions: { reaction: OutfitReaction; reason?: DislikeReason | null; createdAt: Date }[],
) {
  const sorted = [...reactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const opinions = sorted.filter((r) => r.reaction !== "wore");
  const latest = opinions.at(-1);
  const last = latest?.reaction;
  return {
    opinion: last === "like" || last === "dislike" ? last : null,
    reason: last === "dislike" ? (latest?.reason ?? null) : null,
    woreCount: sorted.filter((r) => r.reaction === "wore").length,
  } satisfies Pick<Outfit, "opinion" | "reason" | "woreCount">;
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
    verdict: outfitRequests.verdict,
    dailyOn: outfitRequests.dailyOn,
    createdAt: outfitRequests.createdAt,
  };

  // A request about a piece: the others are what deleting a styling or its item leaves.
  const aboutAPiece = or(isNotNull(outfitRequests.itemId), isNotNull(outfitRequests.heroPhotoKey));

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
        .where(
          and(eq(outfitRequests.userId, userId), eq(outfitRequests.status, "done"), aboutAPiece),
        )
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

    async latestAsked(userId, hero, mood) {
      const [row] = await db
        .select(requestColumns)
        .from(outfitRequests)
        .where(
          and(
            eq(outfitRequests.userId, userId),
            "itemId" in hero
              ? eq(outfitRequests.itemId, hero.itemId)
              : eq(outfitRequests.heroPhotoKey, hero.heroPhotoKey),
            mood ? eq(outfitRequests.mood, mood) : isNull(outfitRequests.mood),
            ne(outfitRequests.status, "failed"),
          ),
        )
        .orderBy(desc(outfitRequests.createdAt))
        .limit(1);
      return row ?? null;
    },

    async saveOutfits(requestId, userId, looks, cost, verdict = null) {
      return db.transaction(async (tx) => {
        // First, so a request deleted meanwhile is noticed before any look points to it.
        const updated = await tx
          .update(outfitRequests)
          .set({ status: "done", costMicros: cost.micros, tokens: cost.tokens ?? null, verdict })
          .where(eq(outfitRequests.id, requestId))
          .returning({ id: outfitRequests.id });
        if (updated.length === 0) return false;
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
        return true;
      });
    },

    async findDailyRequest(userId, day) {
      const [row] = await db
        .select({ id: outfitRequests.id })
        .from(outfitRequests)
        .where(and(eq(outfitRequests.userId, userId), eq(outfitRequests.dailyOn, day)));
      return row?.id ?? null;
    },

    async dailyRequest(userId, day, wardrobeSize) {
      // Two at once both insert; the index keeps one, and both read it back.
      await db
        .insert(outfitRequests)
        .values({ userId, dailyOn: day, wardrobeSize, status: "done" })
        .onConflictDoNothing();
      const [row] = await db
        .select({ id: outfitRequests.id })
        .from(outfitRequests)
        .where(and(eq(outfitRequests.userId, userId), eq(outfitRequests.dailyOn, day)));
      return row!.id;
    },

    async addDailyLook(requestId, userId, look, shown) {
      return db.transaction(async (tx) => {
        // Locked, so a second add waits for this one and then counts its look.
        await tx
          .select({ id: outfitRequests.id })
          .from(outfitRequests)
          .where(eq(outfitRequests.id, requestId))
          .for("update");
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(outfits)
          .where(eq(outfits.requestId, requestId));
        if (n !== shown) return false;
        const [saved] = await tx
          .insert(outfits)
          .values({ requestId, userId, position: n, ...look })
          .returning({ id: outfits.id });
        if (look.pieces.length > 0) {
          await tx
            .insert(outfitPieces)
            .values(
              look.pieces.map((piece, i) => ({ outfitId: saved!.id, position: i, ...piece })),
            );
        }
        return true;
      });
    },

    async struckPairs(userId, limit) {
      const cut = await db
        .select({ outfitId: outfitPieces.outfitId, itemId: outfitPieces.itemId })
        .from(outfitPieces)
        .innerJoin(outfits, eq(outfits.id, outfitPieces.outfitId))
        .where(
          and(
            eq(outfits.userId, userId),
            isNotNull(outfitPieces.struckAt),
            isNotNull(outfitPieces.itemId),
          ),
        )
        .orderBy(desc(outfitPieces.struckAt))
        .limit(limit);
      if (cut.length === 0) return [];
      const others = await db
        .select({ outfitId: outfitPieces.outfitId, itemId: outfitPieces.itemId })
        .from(outfitPieces)
        .where(
          and(
            inArray(
              outfitPieces.outfitId,
              cut.map((c) => c.outfitId),
            ),
            isNotNull(outfitPieces.itemId),
          ),
        );
      return cut.flatMap((c) =>
        others
          .filter((o) => o.outfitId === c.outfitId && o.itemId !== c.itemId)
          .map((o) => pairKey(c.itemId!, o.itemId!)),
      );
    },

    async markFailed(requestId) {
      await db
        .update(outfitRequests)
        .set({ status: "failed" })
        .where(eq(outfitRequests.id, requestId));
    },

    async deleteRequest(requestId, userId) {
      return db.transaction(async (tx) => {
        // Locked, so a second delete at once waits for this one, then reads the row as it left it:
        // gone, or with neither piece. It finds nothing to delete, and answers false.
        const [own] = await tx
          .select({ id: outfitRequests.id })
          .from(outfitRequests)
          .where(
            and(eq(outfitRequests.id, requestId), eq(outfitRequests.userId, userId), aboutAPiece),
          )
          .for("update");
        if (!own) return false;
        // Its looks are locked too, before reading which have reactions. A reaction being written
        // holds its look's key: this waits for it and then sees it. One that comes later waits for
        // this, then lands on a look that stayed, or finds its look gone and answers false.
        await tx
          .select({ id: outfits.id })
          .from(outfits)
          .where(eq(outfits.requestId, requestId))
          .for("update");
        const reacted = await tx
          .selectDistinct({ id: outfits.id })
          .from(outfits)
          .innerJoin(outfitReactions, eq(outfitReactions.outfitId, outfits.id))
          .where(eq(outfits.requestId, requestId));
        if (reacted.length === 0) {
          // Looks, pieces and the wish go with it (foreign keys).
          await tx.delete(outfitRequests).where(eq(outfitRequests.id, requestId));
          return true;
        }
        await tx.delete(wishes).where(eq(wishes.requestId, requestId));
        await tx.delete(outfits).where(
          and(
            eq(outfits.requestId, requestId),
            notInArray(
              outfits.id,
              reacted.map((look) => look.id),
            ),
          ),
        );
        // The route deletes the photo, unless a closet item uses it. What the piece was and whether
        // to buy it go too: the brief reads neither.
        await tx
          .update(outfitRequests)
          .set({ itemId: null, heroPhotoKey: null, heroNoun: null, verdict: null })
          .where(eq(outfitRequests.id, requestId));
        return true;
      });
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
                id: outfitPieces.id,
                outfitId: outfitPieces.outfitId,
                position: outfitPieces.position,
                hero: outfitPieces.hero,
                struckAt: outfitPieces.struckAt,
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
        verdict: null,
        wishId: null,
        outfits: looks.map((look) => ({
          id: look.id,
          caption: look.caption,
          occasion: look.occasion,
          why: look.why,
          missing: look.missing ?? null,
          pieces: pieces
            .filter((p) => p.outfitId === look.id)
            .map((p) => ({
              id: p.id,
              hero: p.hero,
              struck: p.struckAt !== null,
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

    async react(outfitId, userId, reaction, reason) {
      const [own] = await db
        .select({ id: outfits.id })
        .from(outfits)
        .where(and(eq(outfits.id, outfitId), eq(outfits.userId, userId)));
      if (!own) return false;
      try {
        await db.insert(outfitReactions).values({ outfitId, userId, reaction, reason });
      } catch (cause) {
        // The look went after the check: its styling was deleted just now.
        if (isForeignKeyViolation(cause)) return false;
        throw cause;
      }
      return true;
    },

    async strike(outfitId, pieceId, userId, struck) {
      const [piece] = await db
        .select({ hero: outfitPieces.hero })
        .from(outfitPieces)
        .innerJoin(outfits, eq(outfits.id, outfitPieces.outfitId))
        .where(
          and(
            eq(outfitPieces.id, pieceId),
            eq(outfitPieces.outfitId, outfitId),
            eq(outfits.userId, userId),
          ),
        );
      if (!piece) return "missing";
      if (piece.hero) return "hero";
      await db
        .update(outfitPieces)
        // A second cut keeps the first one's time, so a retry doesn't reorder what she cut.
        .set({ struckAt: struck ? sql`coalesce(${outfitPieces.struckAt}, now())` : null })
        .where(eq(outfitPieces.id, pieceId));
      return "ok";
    },

    async woreDays(userId, since, offsetSeconds) {
      const rows = await db
        .selectDistinct({
          day: sql<string>`to_char((${outfitReactions.createdAt} at time zone 'UTC') + make_interval(secs => ${offsetSeconds}), 'YYYY-MM-DD')`,
        })
        .from(outfitReactions)
        .where(
          and(
            eq(outfitReactions.userId, userId),
            eq(outfitReactions.reaction, "wore"),
            gte(outfitReactions.createdAt, since),
          ),
        );
      return rows.map((r) => r.day).sort();
    },

    async woreLooks(userId, since, offsetSeconds) {
      // Written into the query rather than bound: DISTINCT ON must repeat ORDER BY's expression
      // exactly, and two parameters are two expressions. An integer, so nothing can be injected.
      const offset = sql.raw(String(Math.trunc(offsetSeconds)));
      const day = sql<string>`to_char((${outfitReactions.createdAt} at time zone 'UTC') + make_interval(secs => ${offset}), 'YYYY-MM-DD')`;
      const rows = await db
        .selectDistinctOn([day], { day, outfitId: outfits.id, requestId: outfits.requestId })
        .from(outfitReactions)
        .innerJoin(outfits, eq(outfits.id, outfitReactions.outfitId))
        .where(
          and(
            eq(outfitReactions.userId, userId),
            eq(outfitReactions.reaction, "wore"),
            gte(outfitReactions.createdAt, since),
          ),
        )
        .orderBy(day, desc(outfitReactions.createdAt));
      return rows;
    },

    async struckPieces(userId, limit) {
      const struck = await db
        .select({
          outfitId: outfitPieces.outfitId,
          piece: items.name,
          heroNoun: outfitRequests.heroNoun,
        })
        .from(outfitPieces)
        .innerJoin(outfits, eq(outfits.id, outfitPieces.outfitId))
        .innerJoin(outfitRequests, eq(outfitRequests.id, outfits.requestId))
        .innerJoin(items, eq(items.id, outfitPieces.itemId))
        .where(and(eq(outfits.userId, userId), isNotNull(outfitPieces.struckAt)))
        .orderBy(desc(outfitPieces.struckAt))
        .limit(limit);
      if (struck.length === 0) return [];
      const heroes = await db
        .select({ outfitId: outfitPieces.outfitId, name: items.name })
        .from(outfitPieces)
        .innerJoin(items, eq(items.id, outfitPieces.itemId))
        .where(
          and(
            inArray(
              outfitPieces.outfitId,
              struck.map((s) => s.outfitId),
            ),
            eq(outfitPieces.hero, true),
          ),
        );
      // A look around a piece from a photo has no hero row with a name: its English noun stands
      // in, or "the piece" when that's gone too.
      return struck.map((s) => ({
        hero: heroes.find((h) => h.outfitId === s.outfitId)?.name ?? s.heroNoun ?? "the piece",
        piece: s.piece,
      }));
    },

    async recentlyUsed(userId, requests) {
      const recent = await db
        .select({ id: outfitRequests.id })
        .from(outfitRequests)
        // Her stylings only: a look of the day would take a styling's place, and count against itself.
        .where(
          and(
            eq(outfitRequests.userId, userId),
            eq(outfitRequests.status, "done"),
            isNull(outfitRequests.dailyOn),
          ),
        )
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

    async reactedOutfitCount(userId) {
      const [row] = await db
        .select({ n: countDistinct(outfitReactions.outfitId) })
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
      // Newest reaction first, as asked for: the query itself keeps no order.
      const newestFirst = [...looks].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      return newestFirst.map((look) => {
        const { opinion, reason, woreCount } = summarize(
          reactions.filter((r) => r.outfitId === look.id),
        );
        const names = pieces.filter((p) => p.outfitId === look.id).map((p) => p.name);
        return {
          opinion,
          reason,
          wore: woreCount > 0,
          // Only wardrobe pieces have names here: a look of partner pieces is its caption alone.
          // A look of the day has no caption: its pieces say it.
          description: look.caption
            ? names.length
              ? `"${look.caption}": ${names.join(" + ")}`
              : `"${look.caption}"`
            : names.join(" + "),
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

    async attachedKeys(photoKeys) {
      if (photoKeys.length === 0) return new Set();
      const rows = await db
        .select({ key: items.photoKey })
        .from(items)
        .where(inArray(items.photoKey, photoKeys));
      return new Set(rows.flatMap((row) => (row.key ? [row.key] : [])));
    },

    async brief(userId) {
      const [row] = await db.select().from(styleBriefs).where(eq(styleBriefs.userId, userId));
      if (!row) return null;
      const { userId: _userId, ...brief } = row;
      return brief;
    },

    async setBriefBatch(userId, batchId, requestedAt) {
      await db
        .insert(styleBriefs)
        .values({ userId, batchId, requestedAt })
        .onConflictDoUpdate({ target: styleBriefs.userId, set: { batchId, requestedAt } });
    },

    async dropBriefBatch(userId) {
      await db.update(styleBriefs).set({ batchId: null }).where(eq(styleBriefs.userId, userId));
    },

    async saveBrief(userId, { brief, summary }, counts, writtenAt) {
      const set = {
        brief,
        summary,
        ...counts,
        writtenAt,
        batchId: null,
        requestedAt: null,
      };
      await db
        .insert(styleBriefs)
        .values({ userId, ...set })
        .onConflictDoUpdate({ target: styleBriefs.userId, set });
    },

    async askBrief(userId, askedAt) {
      await db
        .insert(styleBriefs)
        .values({ userId, askedAt })
        .onConflictDoUpdate({ target: styleBriefs.userId, set: { askedAt } });
    },

    async addedSince(userId, since) {
      const [added] = await db
        .select({ n: count() })
        .from(items)
        .innerJoin(photos, eq(photos.key, items.photoKey))
        .where(
          and(eq(items.ownerId, userId), eq(photos.status, "ready"), gt(items.createdAt, since)),
        );
      const [saved] = await db
        .select({ n: count() })
        .from(photos)
        .where(
          and(
            eq(photos.ownerId, userId),
            eq(photos.kind, "inspiration"),
            eq(photos.status, "ready"),
            gt(photos.createdAt, since),
          ),
        );
      return { items: added?.n ?? 0, looks: saved?.n ?? 0 };
    },
  };
}
