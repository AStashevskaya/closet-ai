import {
  FREE_LIMITS,
  MONTHLY_SAFETY_LIMITS,
  limitMessage,
  type SpendAction,
  type Usage,
  type UsageAction,
  type UsagePeriod,
} from "@closet-ai/shared";
import { httpError } from "../../http-error";
import type { UsageRepository } from "./usage.repository";

// What one counted action roughly costs us, in millionths of a dollar (October 2026 prices):
// an item photo is tagged (Haiku) and cut out (SAM 3); a "want" screenshot is also cut out
// and compared item by item; a selfie is only read; outfits around an item are one Haiku call
// with the stable part of the prompt cached. The outfit job records the real cost on its request:
// 2.5 ¢ on average over the owner's 72 requests, 3.2 ¢ over the last 20 (2026-10-24).
export const ESTIMATED_COST_MICROS: Record<UsageAction, number> = {
  item_photo: 6_000,
  want: 10_000,
  look: 2_000,
  wear_with: 30_000,
  // Stored only; the brief that reads it is paid for separately.
  inspiration: 0,
};

// An Opus brief through the Batch API, to check the room for one before sending it; what it
// really cost is recorded once it's back.
export const BRIEF_COST_MICROS = 100_000;

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

// The share of the server's daily budget at which a log line warns, once a UTC day per process.
export const BUDGET_WARN_SHARE = 0.5;

// People testing the app (TESTER_USER_IDS) get roomier limits, so a test session doesn't stop
// halfway; the server's daily budget and the $5 a month per user still apply to them.
export const TESTER_LIMITS: Partial<Record<UsageAction, number>> = {
  wear_with: 30,
  want: 30,
  look: 30,
};

// The free tier for everyone (no Pro yet). Checks answer 429 with a limit:<code> message, which
// the app turns into its own words.
export function createLimits(
  usage: UsageRepository,
  budgets: {
    // The server's daily safety stop, for everyone together.
    dailyUsd: number;
    // What one user's AI may cost us in a calendar month, background briefs included.
    userMonthlyUsd: number;
    // Where the half-budget warning goes: the API's logger, or a JSON line on stdout.
    log?: (line: Record<string, unknown>) => void;
  },
  testers: ReadonlySet<string> = new Set(),
  clock: () => Date = () => new Date(),
) {
  const budgetMicros = Math.round(budgets.dailyUsd * 1_000_000);
  const userMonthlyMicros = Math.round(budgets.userMonthlyUsd * 1_000_000);

  // The spend caps, checked before anything that costs `costMicros`: the user's month first,
  // since that's the one they can do something about (wait for the 1st).
  async function roomFor(userId: string, costMicros: number, now: Date) {
    if ((await usage.spentBy(userId, periodStart("month", now))) + costMicros > userMonthlyMicros)
      return "monthly";
    if ((await usage.spentSince(periodStart("day", now))) + costMicros > budgetMicros)
      return "budget";
    return null;
  }
  // Once spend crosses half of the day's budget, say so, so the stop doesn't come as a surprise.
  // Each process (API, worker) remembers its own day, so both may log the same crossing.
  const log = budgets.log ?? ((line) => console.log(JSON.stringify(line)));
  let warnedDay: number | null = null;
  async function warnPastHalf(now: Date) {
    const day = periodStart("day", now);
    if (warnedDay === day.getTime()) return;
    const spent = await usage.spentSince(day);
    if (spent < budgetMicros * BUDGET_WARN_SHARE) return;
    warnedDay = day.getTime();
    log({ msg: "ai budget half spent", spentUsd: spent / 1_000_000, budgetUsd: budgets.dailyUsd });
  }

  // The action is recorded by then: a failed check must not fail it.
  const warnSafely = () => warnPastHalf(clock()).catch(() => undefined);

  // The count allowed per period: the free tier's, or a tester's.
  const allowed = (userId: string, action: UsageAction) =>
    (testers.has(userId) ? TESTER_LIMITS[action] : undefined) ?? FREE_LIMITS[action].count;

  return {
    // Before the action: throws when the user's limit or the server's daily budget is used up.
    async check(userId: string, action: UsageAction) {
      const now = clock();
      const { period } = FREE_LIMITS[action];
      if (
        (await usage.count(userId, action, periodStart(period, now))) >= allowed(userId, action)
      ) {
        throw httpError(429, limitMessage(action));
      }
      // Testers have no hidden monthly count; their spend is capped like everyone's.
      const monthly = testers.has(userId) ? undefined : MONTHLY_SAFETY_LIMITS[action];
      if (
        monthly !== undefined &&
        (await usage.count(userId, action, periodStart("month", now))) >= monthly
      ) {
        throw httpError(429, limitMessage(action));
      }
      // Saving a look costs nothing, so a user past her cap can still save one.
      const cost = ESTIMATED_COST_MICROS[action];
      const over = cost > 0 ? await roomFor(userId, cost, now) : null;
      if (over) throw httpError(429, limitMessage(over));
    },

    // For background work no request asked for (the style brief): whether both caps have room,
    // at the job's time. Nothing is reserved, so a brief can go past the cap by its own cost.
    async allows(userId: string, costMicros: number, now = clock()) {
      return (await roomFor(userId, costMicros, now)) === null;
    },

    // What background work really cost, once it's known.
    async spent(userId: string, action: SpendAction, costMicros: number) {
      await usage.record(userId, action, costMicros);
      await warnSafely();
    },

    // Once the action went through (the photo is stored and queued).
    async record(userId: string, action: UsageAction) {
      await usage.record(userId, action, ESTIMATED_COST_MICROS[action]);
      await warnSafely();
    },

    async summary(userId: string): Promise<Usage> {
      const now = clock();
      const counted = async (action: "want" | "look" | "wear_with") => {
        const { period } = FREE_LIMITS[action];
        return {
          used: await usage.count(userId, action, periodStart(period, now)),
          limit: allowed(userId, action),
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
