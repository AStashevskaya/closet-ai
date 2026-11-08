import type { SpendAction, WantMoreCode } from "@closet-ai/shared";
import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import type { Db } from "../../db/client";
import { user } from "../../db/auth-schema";
import { usageEvents, wantMoreTaps } from "../../db/schema";

export interface UsageRepository {
  record(userId: string, action: SpendAction, costMicros: number): Promise<void>;
  // How many times the user did this since `since`.
  count(userId: string, action: SpendAction, since: Date): Promise<number>;
  // Spend of everyone since `since`, in millionths of a dollar.
  spentSince(since: Date): Promise<number>;
  // The same for one user.
  spentBy(userId: string, since: Date): Promise<number>;
  // When the account was made, for the first week's limits; null if it's gone.
  accountCreatedAt(userId: string): Promise<Date | null>;
  // She tapped "I want more" on this limit.
  wantMore(userId: string, code: WantMoreCode): Promise<void>;
}

export function createUsageRepository(db: Db): UsageRepository {
  return {
    async record(userId, action, costMicros) {
      await db.insert(usageEvents).values({ userId, action, costMicros });
    },

    async count(userId, action, since) {
      const [row] = await db
        .select({ n: count() })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.userId, userId),
            eq(usageEvents.action, action),
            gte(usageEvents.createdAt, since),
          ),
        );
      return row?.n ?? 0;
    },

    async spentSince(since) {
      const [row] = await db
        .select({ total: sum(usageEvents.costMicros) })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, since));
      return Number(row?.total ?? 0);
    },

    async spentBy(userId, since) {
      const [row] = await db
        .select({ total: sum(usageEvents.costMicros) })
        .from(usageEvents)
        .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, since)));
      return Number(row?.total ?? 0);
    },

    async accountCreatedAt(userId) {
      const [row] = await db
        .select({ createdAt: user.createdAt })
        .from(user)
        .where(eq(user.id, userId));
      return row?.createdAt ?? null;
    },

    async wantMore(userId, code) {
      await db
        .insert(wantMoreTaps)
        .values({ userId, code })
        .onConflictDoUpdate({
          target: [wantMoreTaps.userId, wantMoreTaps.code],
          set: { taps: sql`${wantMoreTaps.taps} + 1`, lastAt: new Date() },
        });
    },
  };
}
