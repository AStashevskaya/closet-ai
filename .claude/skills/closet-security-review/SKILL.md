---
name: closet-security-review
description: Security and privacy review of one closet-ai flow or diff (auth, photos and uploads, items, looks, wishes, sharing, AI outputs, limits, account deletion, later RevenueCat). Read-only; reports evidenced findings. Run before a build for testers and on PRs that touch auth, storage or who can see what.
disable-model-invocation: true
---

# Security review for closet-ai

Read-only unless the owner asks for fixes. Scope to the named flow or diff and its trust boundaries; don't audit the whole repo. Never touch production, never print secret values (name the variable instead), never send user photos to a third party for the review. Use throwaway users and synthetic photos, as `.claude/agents/senior-qa.md` describes (own server on port 3100, Redis db 1, `ANTHROPIC_API_KEY=` and `FAL_KEY=` unset).

Ground yourself in `CLAUDE.md` and the touched parts of `docs/server.md`, then trace untrusted input to the sensitive operation. In order:

1. **Ownership on every object.** Items, photos (`photos/<user id>/…`), looks, outfit requests, reactions, wishes, inspiration, catalog events: the user always comes from the Better Auth session, never from the body or query. Someone else's id answers 404 like a missing one. Test with two throwaway users plus no session (401). Check list routes and photo-serving routes too (`/api/items/:id/photo`, `/api/inspiration/photo?key=`, `/api/wear-with/:id/photo`): a `key` parameter must be checked against the caller's prefix or rows.
2. **Sessions.** Expiry, sign-out, deleted user, switching accounts on one phone (SecureStore cleared, cached images and query data not shown to the next user).
3. **Uploads.** 10 MB cap enforced before buffering, header check (JPEG/PNG/WebP), decoded-pixel cap (`PHOTO_MAX_PIXELS`) so a small file can't decode to a huge bitmap, EXIF/GPS stripped, originals deleted. S3 objects private, served only through the API with `Cache-Control: private`.
4. **AI input and output.** Screenshots, catalog text and model answers are untrusted data. Structured output validated with Zod; item and catalog ids the model returns are checked against the user's own rows (made-up ids dropped); no other user's data, secrets or e-mail in prompts.
5. **Cost abuse.** Free-tier limits (`shared/src/limits.ts`), the monthly per-user budget and the daily server budget are checked *before* the paid call; retries bounded; a second tap while the first request is running doesn't pay twice.
6. **Privacy.** Logs and analytics carry ids, not names, e-mails, photo contents or prompts. Account deletion removes every table (ON DELETE CASCADE) and every file by prefix, including cut-outs, crops and hero photos; brands only ever see aggregates.
7. **Later, when it ships:** RevenueCat entitlements verified on the server (webhook signature, replay, idempotent grants; a client flag is never authorization); sharing with stylists needs explicit grants and revocation.

Report in Russian, short: only evidenced findings, each with severity, `path:line`, preconditions, impact, a safe reproduction (or the missing test) and the smallest fix. Keep confirmed issues apart from hypotheses. "No findings" means none found in this scope, not a certificate.
