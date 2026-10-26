# closet-ai: notes for Claude Code

## What this is

A wardrobe app, mobile-first. You photograph an item and the app tells you what to wear it with, or helps you sell it. Everything you photograph ends up in your digital wardrobe, so it fills up as a side effect instead of a chore.

The core feature is "Want / Can" (shown in the app as "Recreate the look" / «Воссоздай образ» / «ליצור את הלוק מחדש» since 2026-10-22, the owner found "Want / Can" unclear; code, routes and keys keep `want` / `wantCan`): the user drops in one item they want (a Balenciaga jacket from Instagram) and the app finds something similar for less from partner brands and resale, plus what close to it they already own. Its sibling is "Inspiration" (Вдохновение / השראה): looks the user likes, saved from screenshots, shared from Pinterest or picked in onboarding, which teach the app their taste and are rebuilt from their wardrobe. See "Feature boundaries" in docs/product.md (decided 2026-10-21).

First market is Israel (Hebrew + Russian, Yad2 and Facebook groups), then Ukraine and Belarus. Free tier forever, 7-day Pro trial, then subscription via RevenueCat. Stylists will later get access to clients' wardrobes, so sharing is part of the data model from the start. See README.md for the full roadmap.

This is also a learning project. The owner is a frontend engineer (React, React Native) building her backend, TypeScript and AI skills on it, and it is part of her portfolio.

## Working with me

- Explain non-obvious decisions in a sentence or two (why this library, why this pattern). I want to understand the code, not just receive it.
- Small, focused commits with conventional messages (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
- Don't add a dependency without saying what it's for and what the alternative was.
- Run `pnpm typecheck`, `pnpm lint` and `pnpm test` before saying something is done.
- If a task is ambiguous or touches the data model in a way that's hard to undo, ask first.
- One topic per PR, kept small; open it as soon as the topic is done and checked.
- Once a PR is open, run the `senior-reviewer` agent on it and fix what blocks before handing it over. Run `senior-qa` every fourth PR or so (on the newest, which carries the ones before it), and always before a build for testers.

## Where things are

- `docs/server.md`: the server module by module (auth, items, photo pipeline, tagging, embeddings, cut-outs, looks, Want / Can, limits, outfits, Inspiration, account deletion, brand and price, profile details, partner catalog, workers, migrations).
- `docs/client.md`: the app (screens, the "Maison" look, motion, i18n, API and photo loading, tests).
- `docs/product.md`: roadmap, Free / Premium, outfit taste, feature boundaries, partner items, Want / Can, the brand demo.
- `.claude/skills/fashion-creative-director`: the creative-director skill for UI work (new screens, redesigns, motion): three directions and approval before building anything significant.
- Technical roadmap with options and trade-offs per step: https://claude.ai/code/artifact/d1343c0a-0f00-4893-aa36-76e2c3684035

## Stack

- pnpm monorepo (`client`, `server`, `shared`), TypeScript ~6.0 strict everywhere (keep one TypeScript version: two make pnpm install `expo` twice), Node 22. pnpm may not be on PATH: `corepack enable` once, or `corepack pnpm …`.
- Server: Fastify 5 + Zod, Drizzle on Postgres 17 + pgvector, Better Auth, BullMQ on Redis, S3 storage (SeaweedFS locally, Cloudflare R2 in production). AI: Claude Haiku (tags, outfits), Opus via the Batch API (style brief), SAM 3 on fal (cut-outs), Marqo-FashionSigLIP locally (embeddings).
- Client: Expo SDK 58 (React Native 0.88, React 19.3), Expo Router, Reanimated 4, Gesture Handler 3, i18next (en, he, ru).
- Shared: Zod schemas and types, raw TS, no build step.
- No `node-linker=hoisted`: Expo supports pnpm isolated installs since SDK 54. Switch to `nodeLinker: hoisted` in `pnpm-workspace.yaml` only if a native library breaks.
- `docker-compose.yml`: Postgres 17 + pgvector, Redis and SeaweedFS (S3 API on 8333, development keys in `docker/seaweedfs/s3.json`), published on 127.0.0.1 only. `docker/postgres/init.sql` creates `closet_test` when the volume is first created (`docker compose down -v` to recreate). On the owner's Mac Docker runs in OrbStack.
- Lint: ESLint 9 (not 10: `eslint-plugin-react` inside `eslint-config-expo` crashes on 10). Root `eslint.config.js` covers `server` and `shared` with type-aware `typescript-eslint` rules; `client/eslint.config.js` uses `eslint-config-expo`, which includes the React Compiler rules. `pnpm lint` runs both and fails on warnings.
- CI: `pnpm install --frozen-lockfile` (with `ONNXRUNTIME_NODE_INSTALL=skip`, so onnxruntime-node doesn't download its CUDA libraries on Linux; set the same in a production Docker build), typecheck (all three packages), lint, tests, with a Postgres 17 + pgvector service for the server's Postgres tests. Commit `pnpm-lock.yaml` together with any `package.json` change.

## Rules that are easy to miss

- Throw `httpError(status, message)` for 4xx from server handlers, not `reply.code()`: the Zod type provider only allows the statuses in the response schema.
- `drizzle-kit generate` asks interactively when a column is renamed: generate a drop and an add separately and merge them into one migration (see `0001_photo_key`). Migrations are committed in `server/drizzle/`.
- Don't edit `server/src/db/auth-schema.ts` by hand: the Better Auth CLI generates it.
- Client: use `colors` / `fonts` from `src/theme.ts`, never raw hex or `fontWeight`; build screens from `src/components/maison.tsx` and `rise` / `STAGGER_STEP`.
- Client code uses single quotes (`client/.prettierrc`); server and shared use double quotes (root `.prettierrc`): run Prettier from the right package.
- The global `fetch` (since SDK 57) is `expo/fetch`: files go into FormData as `new File(uri)` from `expo-file-system`.

## Tests

Tests stay inside each package, not in a shared top-level folder:

- `server/test/` for API tests (Vitest). Unit tests for a single module can also sit next to it as `*.test.ts`.
  - `server/test/postgres.test.ts` runs the real app (Drizzle repository, Better Auth Drizzle adapter, committed migrations) on Postgres. It runs only when `TEST_DATABASE_URL` is set, always in CI (a Postgres service in the workflow), and fails in CI if the variable is missing. It wipes that database first, so the database name must end in `_test`. Locally (`pnpm db:up` creates `closet_test`): `TEST_DATABASE_URL=postgres://closet:closet@localhost:5432/closet_test pnpm --filter @closet-ai/server test`.
  - `server/test/storage.test.ts` does the same for S3 storage with `TEST_S3_ENDPOINT` (`http://localhost:8333` locally; CI starts a SeaweedFS container). Shared test setup lives in `server/test/helpers.ts`.
- `client/` uses Jest (jest-expo), with tests next to components as `*.test.tsx`. Never put tests in `src/app`: every file there becomes a route.
- `shared/` gets Vitest only when there's real logic there; plain schemas don't need tests.

Reason: server and client use different test runners and environments (Node vs React Native), and each package should be testable on its own with `pnpm --filter <pkg> test`. If we add end-to-end tests later, they go in a top-level `e2e/`.

## RTL

- The language follows the phone (`supportedLocales` en, he, ru in the `expo-localization` plugin) until one is picked in Profile → Language (`src/lib/language.ts`, kept in SecureStore). `supportsRTL` is deliberately not set: the plugin would re-allow RTL on every launch and a Hebrew phone couldn't pick English. A fresh install allows RTL once by default, and `setLanguage` sets `allowRTL` / `forceRTL` itself and reloads the app when Hebrew comes in or goes.
- Use `start`/`end` (`marginStart`, `paddingEnd`, …) instead of `left`/`right` in styles.
- `textAlign` has no `start`/`end` in React Native: `'left'` follows the layout direction and acts as start.
- Changing direction at runtime (`I18nManager`) needs an app restart and does not work in Expo Go.

## Conventions

- Zod schema in `shared` is the single source of truth: TS types, request validation and DB enums (category, season, color) come from it.
- AI calls go through one client module in `server` so tests can swap it for a stub and never spend money.
- Secrets only in `.env`, never committed. `.env.example` is kept up to date.
- UI strings go through i18n from the start (en as fallback, he, ru; uk later). No hardcoded text in components. New strings go into `en.json` first; a test checks that he and ru have the same keys. Russian copy addresses the user as «ты» (as in the design), never «вы».

## Commands

```bash
pnpm install
pnpm db:up                                    # Postgres + Redis in Docker
cp server/.env.example server/.env              # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm --filter @closet-ai/server db:migrate     # apply committed migrations
pnpm --filter @closet-ai/server db:generate    # only after changing src/db/schema.ts; commit the result
pnpm dev:server                               # API on http://localhost:3000
pnpm dev:client                               # Expo dev server
pnpm typecheck
pnpm lint
pnpm test
```

