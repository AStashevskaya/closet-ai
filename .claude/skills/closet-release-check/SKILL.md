---
name: closet-release-check
description: Readiness checklist for one closet-ai build before testers, TestFlight / Google Play testing or a store submission, plus the server version it talks to. Review only; never builds, uploads, deploys or edits store metadata.
disable-model-invocation: true
---

# Release check for closet-ai

Review only. Do not run `eas build`, `eas submit`, `eas update`, deploy the server, change store listings or read production data unless the owner asks for that exact action in this conversation. Name the build: platform, app version and build number, EAS profile, API URL, server commit.

Check what applies, citing files:

1. **Config.** Bundle id / package, version and build number bumped, `eas.json` profile and env (production API URL, no `exp://` or localhost), signing. Missing secrets by variable name only. Server env matches `server/.env.example`; `ONNXRUNTIME_NODE_INSTALL=skip` in the Docker build; the embedding models (vision ~90 MB, text ~110 MB) present in the image or a cache volume so the first request doesn't download them.
2. **Server compatibility.** Migrations in `server/drizzle/` run before the new code; the server still answers builds already installed on testers' phones (no removed fields or routes they call); the BullMQ workers (`WORKERS_IN_API=false` in production) run the same commit.
3. **Core flows on a clean install and on an upgrade:** sign-up / sign-in, add one piece and a batch, a look from a selfie, Recreate the look, Style it, Inspiration, Wishes, delete account (required by the App Store).
4. **Permissions.** Camera and photo-library purpose strings in en, ru, he; denied permission leads somewhere usable.
5. **Languages and access.** Russian (Belarus first), Hebrew RTL (needs a dev build, not Expo Go), English; long Russian strings; Reduce Motion; screen-reader labels on the main actions; offline and error states.
6. **Privacy.** The store privacy answers match what the code does: photos sent to Anthropic (tags, outfits) and fal (cut-outs), e-mail for the account, what is logged, how long photos are kept, deletion. Point out gaps; don't write legal text.
7. **Money.** `AI_DAILY_BUDGET_USD` and `USER_MONTHLY_BUDGET_USD` set for the tester count; limits on. When subscriptions ship: RevenueCat sandbox purchase, restore, cancel, expiry, server-side check; Belarusian cards often fail, so the free path must stay whole.
8. **Monitoring and rollback.** Crash and error reporting without photos or personal data; how to roll back the server and stop a bad OTA update.

For store rules, read the current official Apple / Google pages and give the date; never rely on memory. Run `senior-qa` on the newest PR first, as CLAUDE.md asks before a tester build.

Report in Russian: blockers, recommended fixes, what was checked (and how: ran, read, or needs a device), and what is still unverified for this exact build. If nobody ran the build on a phone, say so.
