import type { BuyCall } from "@closet-ai/shared";
import { and, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { outfitRequests, photos, wishes } from "../../db/schema";

// A wish with what the app shows of it, read with its request and the request's photo.
export interface WishRow {
  id: string;
  requestId: string;
  name: string;
  cutoutKey: string | null;
  call: BuyCall | null;
  askAt: Date;
  stillCount: number;
  createdAt: Date;
}

export type KeepResult = "kept" | "not-due" | "missing";

// Every method takes the user and only touches their wishes.
export interface WishesRepository {
  // Saves the request as a wish, or returns the wish it already is.
  add(userId: string, requestId: string, askAt: Date): Promise<WishRow>;
  // Newest first. A wish whose photo is gone (it can't be while a request points to it, but a
  // wish without it would show nothing) is left out.
  list(userId: string): Promise<WishRow[]>;
  // How many wait for "still want it?" at `now`: the menu row's number.
  countDue(userId: string, now: Date): Promise<number>;
  idFor(userId: string, requestId: string): Promise<string | null>;
  // She still wants it: asked again at askAt. Only once it's due, so a retried request can't
  // count twice.
  keep(userId: string, id: string, now: Date, askAt: Date): Promise<KeepResult>;
  remove(userId: string, id: string): Promise<boolean>;
  // The piece of this photo is in her closet now: bought, so its wish goes.
  removeForPhoto(userId: string, photoKey: string): Promise<void>;
}

export function createWishesRepository(db: Db): WishesRepository {
  const own = (userId: string, id: string) => and(eq(wishes.userId, userId), eq(wishes.id, id));

  // The wishes with their piece's name and cut-out and the request's verdict, in one query.
  const select = () =>
    db
      .select({
        id: wishes.id,
        requestId: wishes.requestId,
        tags: photos.tags,
        cutoutKey: photos.cutoutKey,
        verdict: outfitRequests.verdict,
        askAt: wishes.askAt,
        stillCount: wishes.stillCount,
        createdAt: wishes.createdAt,
      })
      .from(wishes)
      .innerJoin(outfitRequests, eq(outfitRequests.id, wishes.requestId))
      .innerJoin(photos, eq(photos.key, outfitRequests.heroPhotoKey));

  const toRow = ({
    tags,
    verdict,
    ...row
  }: Awaited<ReturnType<typeof select>>[number]): WishRow | null =>
    tags ? { ...row, name: tags.name, call: verdict?.call ?? null } : null;

  return {
    async add(userId, requestId, askAt) {
      await db.insert(wishes).values({ userId, requestId, askAt }).onConflictDoNothing();
      const [row] = await select().where(
        and(eq(wishes.userId, userId), eq(wishes.requestId, requestId)),
      );
      return toRow(row!)!;
    },

    async list(userId) {
      const rows = await select().where(eq(wishes.userId, userId)).orderBy(desc(wishes.createdAt));
      return rows.flatMap((row) => toRow(row) ?? []);
    },

    async countDue(userId, now) {
      const [row] = await db
        .select({ n: count() })
        .from(wishes)
        .where(and(eq(wishes.userId, userId), lte(wishes.askAt, now)));
      return row?.n ?? 0;
    },

    async idFor(userId, requestId) {
      const [row] = await db
        .select({ id: wishes.id })
        .from(wishes)
        .where(and(eq(wishes.userId, userId), eq(wishes.requestId, requestId)));
      return row?.id ?? null;
    },

    async keep(userId, id, now, askAt) {
      // In the database, so two answers at once count twice only if both were due.
      const kept = await db
        .update(wishes)
        .set({ askAt, stillCount: sql`${wishes.stillCount} + 1` })
        .where(and(own(userId, id), lte(wishes.askAt, now)))
        .returning({ id: wishes.id });
      if (kept.length > 0) return "kept";
      const [exists] = await db.select({ id: wishes.id }).from(wishes).where(own(userId, id));
      return exists ? "not-due" : "missing";
    },

    async remove(userId, id) {
      const rows = await db.delete(wishes).where(own(userId, id)).returning({ id: wishes.id });
      return rows.length > 0;
    },

    async removeForPhoto(userId, photoKey) {
      const requests = db
        .select({ id: outfitRequests.id })
        .from(outfitRequests)
        .where(eq(outfitRequests.heroPhotoKey, photoKey));
      await db
        .delete(wishes)
        .where(and(eq(wishes.userId, userId), inArray(wishes.requestId, requests)));
    },
  };
}
