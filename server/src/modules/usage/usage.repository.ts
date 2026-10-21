import type { UsageAction } from "@closet-ai/shared";
import { and, count, eq, gte, sum } from "drizzle-orm";
import type { Db } from "../../db/client";
import { usageEvents } from "../../db/schema";

export interface UsageRepository {
  record(userId: string, action: UsageAction, costMicros: number): Promise<void>;
  // How many times the user did this since `since`.
  count(userId: string, action: UsageAction, since: Date): Promise<number>;
  // Estimated spend of everyone since `since`, in millionths of a dollar.
  spentSince(since: Date): Promise<number>;
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
  };
}
