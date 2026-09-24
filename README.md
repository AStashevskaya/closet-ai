# closet-ai

A wardrobe assistant. You upload photos of your clothes, and the app suggests outfits for a given occasion and weather. It can also look at something you're thinking of buying and tell you whether it fits what you already own: how many new outfits it adds, whether you already have something almost identical, which gap in your wardrobe it would fill.

Status: early development. Right now there's the backend skeleton and a basic items API.

## Stack

- TypeScript (strict), Node.js 22, pnpm workspaces
- Fastify 5 with Zod schemas via `fastify-type-provider-zod`
- PostgreSQL 17 (with pgvector) and Drizzle ORM
- Redis for background jobs (BullMQ, planned)
- Vitest
- LLM with vision for item tagging and outfit generation (planned)

## Project structure

```
apps/
  api/                 Fastify server
    src/
      config/          env validation
      db/              Drizzle schema and client
      modules/items/   routes + repository
      routes/          health check
    test/
packages/
  shared/              Zod schemas and types shared between apps
```

## Getting started

Requirements: Node 22+, pnpm 9+, Docker.

```bash
pnpm install
pnpm db:up                                   # Postgres + Redis
cp apps/api/.env.example apps/api/.env
pnpm --filter @closet-ai/api db:generate     # create a migration from the schema
pnpm --filter @closet-ai/api db:migrate
pnpm dev                                     # http://localhost:3000/health
```

Tests don't need a database, the app gets an in-memory repository:

```bash
pnpm test
```

## Roadmap

- [x] Monorepo, Fastify, Drizzle, Zod, CI
- [ ] Image upload and storage
- [ ] Background jobs (BullMQ) for image processing
- [ ] Automatic item tagging with a vision model (structured output, validated with Zod)
- [ ] Embeddings + pgvector: find similar items and duplicates
- [ ] Outfit generation with LLM tool use
- [ ] "Should I buy it?" check
- [ ] Evals for the prompts
- [ ] Minimal web client
