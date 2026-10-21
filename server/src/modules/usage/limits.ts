import {
  FREE_LIMITS,
  MONTHLY_SAFETY_LIMITS,
  limitMessage,
  type Usage,
  type UsageAction,
  type UsagePeriod,
} from "@closet-ai/shared";
import { httpError } from "../../http-error";
import type { UsageRepository } from "./usage.repository";

// What one counted action roughly costs us, in millionths of a dollar (October 2026 prices):
// an item photo is tagged (Haiku) and cut out (SAM 3); a "want" screenshot is also cut out
// and compared item by item; a selfie is only read; outfits around an item are one Haiku call
// with the stable part of the prompt cached. The outfit job records the real cost on its request.
export const ESTIMATED_COST_MICROS: Record<UsageAction, number> = {
  item_photo: 6_000,
  want: 10_000,
  look: 2_000,
  wear_with: 13_000,
};

// Periods are calendar ones in UTC: a day from midnight, a week from Monday, a month from the 1st.
export function periodStart(period: UsagePeriod, now: Date): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "day") return day;
  if (period === "week") {
    const sinceMonday = (day.getUTCDay() + 6) % 7;
    return new Date(day.getTime() - sinceMonday * 24 * 60 * 60 * 1000);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextPeriodStart(period: UsagePeriod, now: Date): Date {
  const start = periodStart(period, now);
  if (period === "day") return new Date(start.getTime() + 24 * 60 * 60 * 1000);
  if (period === "week") return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export type Limits = ReturnType<typeof createLimits>;

// The free tier for everyone (no Pro yet). Checks answer 429 with a limit:<code> message, which
// the app turns into its own words.
export function createLimits(
  usage: UsageRepository,
  dailyBudgetUsd: number,
  clock: () => Date = () => new Date(),
) {
  const budgetMicros = Math.round(dailyBudgetUsd * 1_000_000);

  return {
    // Before the action: throws when the user's limit or the server's daily budget is used up.
    async check(userId: string, action: UsageAction) {
      const now = clock();
      const { count, period } = FREE_LIMITS[action];
      if ((await usage.count(userId, action, periodStart(period, now))) >= count) {
        throw httpError(429, limitMessage(action));
      }
      const monthly = MONTHLY_SAFETY_LIMITS[action];
      if (
        monthly !== undefined &&
        (await usage.count(userId, action, periodStart("month", now))) >= monthly
      ) {
        throw httpError(429, limitMessage(action));
      }
      const spent = await usage.spentSince(periodStart("day", now));
      if (spent + ESTIMATED_COST_MICROS[action] > budgetMicros) {
        throw httpError(429, limitMessage("budget"));
      }
    },

    // Once the action went through (the photo is stored and queued).
    record(userId: string, action: UsageAction) {
      return usage.record(userId, action, ESTIMATED_COST_MICROS[action]);
    },

    async summary(userId: string): Promise<Usage> {
      const now = clock();
      const counted = async (action: "want" | "look" | "wear_with") => {
        const { count, period } = FREE_LIMITS[action];
        return {
          used: await usage.count(userId, action, periodStart(period, now)),
          limit: count,
          resetsAt: nextPeriodStart(period, now).toISOString(),
        };
      };
      return {
        want: await counted("want"),
        look: await counted("look"),
        wear_with: await counted("wear_with"),
      };
    },
  };
}
