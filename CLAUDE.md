# closet-ai: notes for Claude Code

## What this is

A wardrobe app, mobile-first. You photograph an item and the app tells you what to wear it with, or helps you sell it. Everything you photograph ends up in your digital wardrobe, so it fills up as a side effect instead of a chore.

The core feature is "Want / Can": the user drops in a screenshot of something they want, and the app shows how to (1) build a similar look from their own wardrobe, (2) find something similar for less, (3) sell items they don't wear to afford it.

First market is Israel (Hebrew + Russian, Yad2 and Facebook groups), then Ukraine and Belarus. Free tier forever, 7-day Pro trial, then subscription via RevenueCat. Stylists will later get access to clients' wardrobes, so sharing is part of the data model from the start. See README.md for the full roadmap.

This is also a learning project. The owner is a frontend engineer (React, React Native) building her backend, TypeScript and AI skills on it, and it is part of her portfolio.

## Working with me

- Explain non-obvious decisions in a sentence or two (why this library, why this pattern). I want to understand the code, not just receive it.
- Small, focused commits with conventional messages (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
- Don't add a dependency without saying what it's for and what the alternative was.
- Run `pnpm typecheck` and `pnpm test` before saying something is done.
- If a task is ambiguous or touches the data model in a way that's hard to undo, ask first.

## Current state

- pnpm monorepo (`client`, `server`, `shared`), TypeScript strict, Node 22. pnpm may not be on PATH: use `corepack enable` once, or `corepack pnpm …`.
- `server/` (`@closet-ai/server`): Fastify 5 + Zod (`fastify-type-provider-zod`), Drizzle ORM on Postgres 17 with pgvector, items table, `GET/POST /api/items`, health check. `buildApp` takes the repository as a parameter, so tests use an in-memory repo and need no database.
- `shared/` (`@closet-ai/shared`): Zod schemas and types for server and client. Exported as raw TS (`exports: ./src/index.ts`), no build step.
- `client/` (`@closet-ai/client`): Expo SDK 58, Expo Router (`src/app`), TypeScript. One placeholder screen that imports from `@closet-ai/shared`. `expo-localization` with `supportedLocales: ["he", "ru"]`. No i18n library and no tests yet.
- No `node-linker=hoisted`: Expo supports pnpm isolated installs since SDK 54. Switch to `nodeLinker: hoisted` in `pnpm-workspace.yaml` only if a native library breaks.
- `docker-compose.yml`: Postgres + Redis.
- CI: `pnpm install --frozen-lockfile`, typecheck (all three packages), tests. Commit `pnpm-lock.yaml` together with any `package.json` change.
- Technical roadmap with options and trade-offs per step: https://claude.ai/code/artifact/d1343c0a-0f00-4893-aa36-76e2c3684035

## Tests

Tests stay inside each package, not in a shared top-level folder:

- `server/test/` for API tests (Vitest). Unit tests for a single module can also sit next to it as `*.test.ts`.
- `client/` will use Jest (jest-expo), with tests next to components as `*.test.tsx`.
- `shared/` gets Vitest only when there's real logic there; plain schemas don't need tests.

Reason: server and client use different test runners and environments (Node vs React Native), and each package should be testable on its own with `pnpm --filter <pkg> test`. If we add end-to-end tests later, they go in a top-level `e2e/`.

## RTL

- RTL is on by default in SDK 58; on iOS it only applies to locales listed in `supportedLocales`.
- Use `start`/`end` (`marginStart`, `paddingEnd`, …) instead of `left`/`right` in styles.
- `textAlign` has no `start`/`end` in React Native: `'left'` follows the layout direction and acts as start.
- Changing direction at runtime (`I18nManager`) needs an app restart and does not work in Expo Go.

## After that (v1 roadmap, in order)

1. Image upload and storage.
2. BullMQ job queue for image processing (upload returns immediately, worker processes, client polls or gets SSE).
3. Item tagging with a vision model: structured output validated with Zod. Tags: type, colour, fit, length, fabric, style, brand guess, condition.
4. Background removal.
5. Wardrobe sharing table (owner, grantee, permissions) for stylists later.
6. Item `source` field: `own` / `resale` / `brand_partner`.
7. "What do I wear this with?" from a single item.
8. Declutter: keep / sell / not sure.
9. Listing generator (Hebrew + Russian, price range), shared via the OS share sheet.
10. "Want / Can" part 1: similar look from own wardrobe (embeddings + pgvector).
11. Auth, free-tier limits, RevenueCat trial.
12. Prompt evals: a few test wardrobes, scored by hand, rerun after each prompt change.

## Conventions

- Zod schema in `shared` is the single source of truth: TS types, request validation and DB enums come from it.
- AI calls go through one client module in `server` so tests can swap it for a stub and never spend money.
- Secrets only in `.env`, never committed. `.env.example` is kept up to date.
- UI strings go through i18n from the start (he, ru; uk later). No hardcoded text in components.

## Commands

```bash
pnpm install
pnpm db:up                                    # Postgres + Redis in Docker
cp server/.env.example server/.env
pnpm --filter @closet-ai/server db:generate
pnpm --filter @closet-ai/server db:migrate
pnpm dev:server                               # API on http://localhost:3000
pnpm dev:client                               # Expo dev server
pnpm typecheck
pnpm test
```
