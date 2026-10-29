# closet-ai

A wardrobe app that helps you get more out of the clothes you already have. Take a photo of an item and the app tells you what to wear it with, or helps you sell it if it's time to let it go. The wardrobe fills up as a side effect: every item you photograph, sell or ask about is saved.

The core feature is **"Want / Can"**. Drop in one thing you want, say a ₪2,000 Balenciaga jacket from Instagram, and the app shows three ways to get there:

1. The closest piece you already own.
2. Something similar for less, from smaller brands or secondhand.
3. Sell a few things you don't wear and buy the original. The app shows which items and roughly how much they'd bring.

Next to it, **Inspiration**: save looks you like (screenshots, Pinterest through the share sheet, style cards when you sign up). The app learns your taste from them and rebuilds each look from your wardrobe, so outfits it suggests feel like yours, not anyone's.

Brands can pay to have their items suggested, always marked as partner items and only where they fit: a cheaper alternative in Want / Can, the missing piece of a saved look, or the one thing an outfit lacks.

First market: Belarus (Russian; resale on Kufar, Telegram and Instagram), then Israel (Hebrew, Yad2 and Facebook groups) and Ukraine. In-store subscriptions often fail with Belarusian cards, so partner brands are the main revenue there at first.

Status: early development. The API (Fastify, Postgres) and the Expo app are in place, with email + password sign-in and the app in English, Hebrew and Russian. Image upload is next.

## How it works for people

- **Free, forever:** a wardrobe of any size, a few outfits a week, 5 "Want / Can" a month, 3 listings a month.
- **Pro, 7-day free trial:** no limits, price suggestions, photo clean-up, full "Want / Can".
- When Pro ends, you drop back to the free tier. Nothing in your wardrobe is lost.

Stylists are part of the plan, much later (not part of the launch): a person can give a stylist access to their wardrobe, and the stylist can suggest outfits, flag items to sell and leave a shopping list. The app is meant to be a tool for stylists, not a replacement for them.

## Stack

- TypeScript (strict), Node.js 22, pnpm workspaces
- Fastify 5 with Zod schemas via `fastify-type-provider-zod`
- PostgreSQL 17 (with pgvector) and Drizzle ORM
- Redis + BullMQ for background jobs (planned)
- Vitest
- Vision LLM for item tagging, listings and outfits (planned)
- Mobile: React Native with Expo (SDK 58, Expo Router), subscriptions via RevenueCat (planned)
- Stylist dashboard: Next.js (later)

## Project structure

```
client/                Expo (React Native) app                @closet-ai/client
  src/app/             Expo Router routes
  src/screens/         screen bodies (routes only render them)
  src/i18n/            translations: en, he, ru
  src/lib/             API URL, auth client
server/                Fastify API                            @closet-ai/server
  src/
    auth/              Better Auth setup, /api/auth/* routes, requireUser
    config/            env validation
    db/                Drizzle schema and client
  drizzle/             SQL migrations (committed)
    modules/items/     routes + repository
    routes/            health check
  test/
shared/                Zod schemas and types for client and server   @closet-ai/shared
```

Tests live inside each package and run on their own with `pnpm --filter <pkg> test`.

## Getting started

Requirements: Node 22+, pnpm 9+ (`corepack enable`), Docker (on a Mac: OrbStack or Docker Desktop).

```bash
pnpm install
pnpm db:up                                   # Postgres + Redis
cp server/.env.example server/.env           # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm --filter @closet-ai/server db:migrate   # apply the committed migrations
pnpm dev:server                              # http://localhost:3000/health
pnpm dev:client                              # Expo dev server (scan the QR code with Expo Go)
```

The phone and the computer need to be on the same Wi-Fi: in development the app calls the API on the computer's LAN address, port 3000.

After changing `server/src/db/schema.ts`, create a new migration with `pnpm --filter @closet-ai/server db:generate` and commit it.

Tests don't need a database: the API tests use Better Auth's in-memory adapter and an in-memory repository.

```bash
pnpm test
```

## Roadmap

### v1: photo → wear it or sell it (6–8 weeks)

- [x] Monorepo, Fastify, Drizzle, Zod, CI
- [x] Expo app with i18n (English, Hebrew, Russian) and RTL
- [x] Email + password sign-in (Better Auth), each user sees only their own items
- [ ] Image upload and storage
- [ ] Background jobs (BullMQ) for image processing
- [ ] Item tagging with a vision model: type, colour, fit, length, fabric, brand, condition (structured output, validated with Zod)
- [ ] Background removal
- [ ] Wardrobe sharing model in the database (who can see or edit whose wardrobe), so stylists can be added later without a rewrite
- [ ] "What do I wear this with?" from a single item, with missing pieces shown as optional buys
- [ ] Declutter flow: swipe keep / sell / not sure
- [ ] Listing generator in Russian and Hebrew with a price range; share to Kufar / Telegram / Instagram (Belarus), Yad2 / Facebook Marketplace (Israel) or Vinted via the share sheet
- [x] Look screenshot → the same look from your own wardrobe (embeddings + pgvector); becomes Inspiration
- [ ] "Want / Can" for one item: the closest piece you own, then similar for less
- [ ] Expo app: wardrobe, outfits, sell; RTL support for Hebrew from day one
- [ ] Free tier limits and Pro trial via RevenueCat
- [ ] Evals: a few test wardrobes, scored by hand, rerun after every prompt change
- [ ] TestFlight with 20–30 testers

### v2

- [ ] Outfit generation: rules in code first (season, weather, occasion), then the LLM picks from what's left, then a final check on the actual photos
- [ ] Personalisation: a taste profile per person from Inspiration, likes, dislikes and "wore it"
- [ ] Onboarding style cards (generated once, the same for everyone)
- [ ] Partner items in recommendations: catalog, labelling, impressions and clicks for the brand dashboard
- [ ] Photo clean-up (wrinkle-free, catalogue-style) for the wardrobe only, never for listings, with an original / improved toggle
- [ ] Add items from a product link or a mirror selfie
- [ ] "Your wardrobe is worth ₪X" stat for sharing
- [ ] Ukrainian localisation

### v3 and later

- [ ] "Want / Can", part 2: similar for less through partner and affiliate catalogues
- [ ] "Want / Can", part 3: which of your items to sell to afford it
- [ ] Stylist dashboard (Next.js): clients, shared wardrobes, lookbooks, shopping lists
- [ ] Book a stylist from inside the app
