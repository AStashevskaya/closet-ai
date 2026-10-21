import { z } from "zod";

// Free-tier limits (decided 2026-10-21). Everyone is on the free tier until Pro exists, the
// owner included, so she feels the limits like any user. Only the actions that exist are
// enforced; the rest are written down here for when their features are built.
// The wardrobe itself has no limit: an item costs well under a cent once, and outfits need a
// full wardrobe to be any good. Pro is sold on the AI features that cost money each time.

export const USAGE_PERIODS = ["day", "week", "month"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

// Counted AI actions, as stored in usage_events.
export const USAGE_ACTIONS = ["item_photo", "want", "look", "wear_with", "inspiration"] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

export const FREE_LIMITS: Record<UsageAction, { count: number; period: UsagePeriod }> = {
  // A safety cap against abuse rather than a product limit.
  item_photo: { count: 100, period: "day" },
  want: { count: 5, period: "month" },
  look: { count: 3, period: "month" },
  // "What do I wear this with?" is meant to be opened every day, so it's generous.
  wear_with: { count: 5, period: "day" },
  // Saving a look costs nothing (no model reads it until the brief does): a cap against abuse.
  inspiration: { count: 50, period: "day" },
};

// Hidden monthly caps on top, so one account can't cost more than it could ever be worth.
export const MONTHLY_SAFETY_LIMITS: Partial<Record<UsageAction, number>> = { wear_with: 80 };

// Not built yet: daily outfits 3 a week (4 looks each), "make it nice" 3 to try, listings 3 a
// month.

// GET /api/usage: what the app shows next to the counted actions.
const counted = z.object({
  used: z.number().int(),
  limit: z.number().int(),
  // When the period's count starts again (ISO date-time).
  resetsAt: z.string().datetime(),
});
export const usage = z.object({
  want: counted,
  look: counted,
  wear_with: counted,
});
export type Usage = z.infer<typeof usage>;

// The message of a 429 when a limit is reached, so the app can say which one. "budget" is the
// server's daily safety stop for everyone.
export const LIMIT_CODES = [...USAGE_ACTIONS, "budget"] as const;
export type LimitCode = (typeof LIMIT_CODES)[number];
export const limitMessage = (code: LimitCode) => `limit:${code}`;
export function limitCodeOf(message: string): LimitCode | null {
  const code = message.startsWith("limit:") ? message.slice("limit:".length) : null;
  return LIMIT_CODES.includes(code as LimitCode) ? (code as LimitCode) : null;
}
