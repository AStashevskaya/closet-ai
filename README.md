# closet-ai

A wardrobe app that helps you get more out of the clothes you already have. Take a photo of an item and the app tells you what to wear it with, or helps you sell it if it's time to let it go. The wardrobe fills up as a side effect: every item you photograph, sell or ask about is saved.

The core feature is **"Want / Can"**. Drop in a screenshot of something you want, say a ₪2,000 coat from Instagram, and the app shows three ways to get there:

1. Build a similar look from your own wardrobe, without buying anything.
2. Find something similar for less, from smaller brands or secondhand.
3. Sell a few things you don't wear and buy the original. The app shows which items and roughly how much they'd bring.

First markets: Israel (Hebrew and Russian, Yad2 and Facebook groups), then Ukraine and Belarus.

Status: early development. The backend skeleton and a basic items API are in place; the mobile app is next.

## How it works for people

- **Free, forever:** wardrobe up to 30 items, a few outfits a week, 3 listings a month.
- **Pro, 7-day free trial:** no limits, price suggestions, photo clean-up, full "Want / Can".
- When Pro ends, you drop back to the free tier. Nothing in your wardrobe is lost.

Stylists are part of the plan: a person can give a stylist access to their wardrobe, and the stylist can suggest outfits, flag items to sell and leave a shopping list. The app is meant to be a tool for stylists, not a replacement for them.

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
server/                Fastify API                            @closet-ai/server
  src/
    config/            env validation
    db/                Drizzle schema and client
    modules/items/     routes + repository
    routes/            health check
  test/
shared/                Zod schemas and types for client and server   @closet-ai/shared
```

Tests live inside each package and run on their own with `pnpm --filter <pkg> test`.

## Getting started

Requirements: Node 22+, pnpm 9+, Docker.

```bash
pnpm install
pnpm db:up                                   # Postgres + Redis
cp server/.env.example server/.env
pnpm --filter @closet-ai/server db:generate  # create a migration from the schema
pnpm --filter @closet-ai/server db:migrate
pnpm dev:server                              # http://localhost:3000/health
pnpm dev:client                              # Expo dev server (scan the QR code with Expo Go)
```

Tests don't need a database, the app gets an in-memory repository:

```bash
pnpm test
```

## Roadmap

### v1: photo → wear it or sell it (6–8 weeks)

- [x] Monorepo, Fastify, Drizzle, Zod, CI
- [ ] Image upload and storage
- [ ] Background jobs (BullMQ) for image processing
- [ ] Item tagging with a vision model: type, colour, fit, length, fabric, brand, condition (structured output, validated with Zod)
- [ ] Background removal
- [ ] Wardrobe sharing model in the database (who can see or edit whose wardrobe), so stylists can be added later without a rewrite
- [ ] "What do I wear this with?" from a single item, with missing pieces shown as optional buys
- [ ] Declutter flow: swipe keep / sell / not sure
- [ ] Listing generator in Hebrew and Russian with a price range; share to Yad2 / Facebook Marketplace / Vinted via the share sheet
- [ ] "Want / Can", part 1: similar look from your own wardrobe (embeddings + pgvector)
- [ ] Expo app: auth, wardrobe, outfits, sell; RTL support for Hebrew from day one
- [ ] Free tier limits and Pro trial via RevenueCat
- [ ] Evals: a few test wardrobes, scored by hand, rerun after every prompt change
- [ ] TestFlight with 20–30 testers

### v2

- [ ] Outfit generation: rules in code first (season, weather, occasion), then the LLM picks from what's left, then a final check on the actual photos
- [ ] Personalisation from likes, dislikes and "wore it"
- [ ] Photo clean-up (wrinkle-free, catalogue-style) for the wardrobe only, never for listings, with an original / improved toggle
- [ ] Add items from a product link or a mirror selfie
- [ ] "Your wardrobe is worth ₪X" stat for sharing
- [ ] Ukrainian localisation

### v3 and later

- [ ] "Want / Can", part 2: find similar for less through affiliate catalogues
- [ ] "Want / Can", part 3: which of your items to sell to afford it
- [ ] Stylist dashboard (Next.js): clients, shared wardrobes, lookbooks, shopping lists
- [ ] Book a stylist from inside the app
