---
name: closet-ai-cost
description: Audit what one closet-ai AI or photo pipeline really costs per action and per month (Haiku tags and outfits, Opus batch briefs, fal SAM 3 cut-outs, local embeddings, storage), find repeated or wasted calls, and check limits and budgets. Use before setting Free / Pro limits or prices, or when spend looks off. Read-only by default.
disable-model-invocation: true
---

# AI cost audit for closet-ai

Production AI spend, not Claude Code tokens. Read-only unless the owner asks for changes; no paid load tests.

1. **Trace one user action end to end** (add a piece, a batch, a selfie, Recreate the look, Style it, a brief): every model call, image step, storage write and job retry. Code: `server/src/ai/*`, `server/src/modules/photos/photo-jobs.ts`, `want-matches.ts`, `outfit-jobs.ts`, the style brief jobs.
2. **Use measured numbers first:** `usage_events` (estimated cost per counted action), `outfit_requests.cost_micros` and `tokens` (input, cache write, cache read, output), `brief` rows. Query the dev DB read-only. Check current prices on the official Anthropic and fal pages and give the date; label every estimate.
3. **Look for waste, in order:** a call repeated after success (client retry plus BullMQ retry), a second tap paying twice, the same photo tagged or cut out twice, the cached prompt prefix written but never read back (it lives 5 minutes, a write costs 1.25×), output budgets far above what answers use, work for users who never come back.
4. **Check the guards:** free-tier limits in `shared/src/limits.ts`, `USER_MONTHLY_BUDGET_USD`, `AI_DAILY_BUDGET_USD` and its "half spent" log, all checked before the paid call; what the user sees when a cap is hit.
5. **Unit economics:** split one-time wardrobe filling from monthly use, free from Pro, and active from idle users. Give cost per action, then per active user a month in two or three named scenarios, failed and retried work included. Belarus first: store payments often fail with Belarusian cards, so compare against partner-brand revenue too (`docs/product.md`).
6. **Cheaper options** (a smaller model, rules before the model, fewer candidates, caching per item) only together with how quality would be checked (`closet-outfit-eval`); never switch a model or drop validation silently.

Report in Russian: a ranked list of changes with the evidence, expected saving, quality risk and how to verify it. Don't promise a percentage without a baseline.
