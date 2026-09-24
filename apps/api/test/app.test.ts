import { randomUUID } from "node:crypto";
import type { Item } from "@closet-ai/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { ItemsRepository } from "../src/modules/items/items.repository";

const env: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
};

function createInMemoryItemsRepository(): ItemsRepository {
  const store: Item[] = [];
  return {
    list: async () => [...store],
    create: async (input) => {
      const created: Item = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      store.push(created);
      return created;
    },
  };
}

let app: Awaited<ReturnType<typeof buildApp>> | undefined;

async function setup() {
  app = await buildApp({ env, itemsRepository: createInMemoryItemsRepository() });
  return app;
}

afterEach(async () => {
  await app?.close();
});

describe("GET /health", () => {
  it("responds with ok", async () => {
    const res = await (await setup()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("/api/items", () => {
  it("creates an item and lists it", async () => {
    const server = await setup();

    const created = await server.inject({
      method: "POST",
      url: "/api/items",
      payload: { name: "White linen shirt", category: "top", colors: ["white"] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<Item>().seasons).toEqual([]);

    const list = await server.inject({ method: "GET", url: "/api/items" });
    expect(list.json<Item[]>()).toHaveLength(1);
  });

  it("rejects an unknown category", async () => {
    const res = await (await setup()).inject({
      method: "POST",
      url: "/api/items",
      payload: { name: "Cape", category: "cape", colors: ["black"] },
    });
    expect(res.statusCode).toBe(400);
  });
});
