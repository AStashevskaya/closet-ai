import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { wishes } from "../../db/schema";

export interface WishRow {
  id: string;
  requestId: string;
  askAt: Date;
  stillCount: number;
  createdAt: Date;
}

// Every method takes the user and only touches their wishes.
export interface WishesRepository {
  // Saves the request as a wish, or returns the wish it already is.
  add(userId: string, requestId: string, askAt: Date): Promise<string>;
  // Newest first.
  list(userId: string): Promise<WishRow[]>;
  idFor(userId: string, requestId: string): Promise<string | null>;
  // She still wants it: asked again at askAt. false when it isn't hers.
  keep(userId: string, id: string, askAt: Date): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
}

export function createWishesRepository(db: Db): WishesRepository {
  const own = (userId: string, id: string) => and(eq(wishes.userId, userId), eq(wishes.id, id));

  return {
    async add(userId, requestId, askAt) {
      await db.insert(wishes).values({ userId, requestId, askAt }).onConflictDoNothing();
      const [row] = await db
        .select({ id: wishes.id })
        .from(wishes)
        .where(and(eq(wishes.userId, userId), eq(wishes.requestId, requestId)));
      return row!.id;
    },

    async list(userId) {
      return db
        .select({
          id: wishes.id,
          requestId: wishes.requestId,
          askAt: wishes.askAt,
          stillCount: wishes.stillCount,
          createdAt: wishes.createdAt,
        })
        .from(wishes)
        .where(eq(wishes.userId, userId))
        .orderBy(desc(wishes.createdAt));
    },

    async idFor(userId, requestId) {
      const [row] = await db
        .select({ id: wishes.id })
        .from(wishes)
        .where(and(eq(wishes.userId, userId), eq(wishes.requestId, requestId)));
      return row?.id ?? null;
    },

    async keep(userId, id, askAt) {
      const rows = await db
        .update(wishes)
        .set({ askAt, stillCount: sql`${wishes.stillCount} + 1` })
        .where(own(userId, id))
        .returning({ id: wishes.id });
      return rows.length > 0;
    },

    async remove(userId, id) {
      const rows = await db.delete(wishes).where(own(userId, id)).returning({ id: wishes.id });
      return rows.length > 0;
    },
  };
}
