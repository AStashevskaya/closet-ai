import { randomUUID } from "node:crypto";
import type { Item } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import type { Env } from "../src/config/env";
import type { ItemsRepository } from "../src/modules/items/items.repository";

const env: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
};

function createInMemoryItemsRepository(): ItemsRepository {
  const store: (Item & { ownerId: string })[] = [];
  return {
    list: async (ownerId) =>
      store.filter((row) => row.ownerId === ownerId).map(({ ownerId: _, ...item }) => item),
    create: async (ownerId, input) => {
      const created: Item = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
      store.push({ ...created, ownerId });
      return created;
    },
  };
}

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup() {
  // Better Auth runs for real, backed by its in-memory adapter instead of Postgres.
  const auth = createAuth(env, memoryAdapter({ user: [], session: [], account: [], verification: [] }));
  app = await buildApp({ env, auth, itemsRepository: createInMemoryItemsRepository() });
  return app;
}

afterEach(async () => {
  await app?.close();
});

// Signs a new user up and returns the session cookie to send with later requests.
async function signUp(server: App, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: "correct-horse-battery" },
  });
  expect(res.statusCode).toBe(200);
  const cookies = res.cookies.map(({ name, value }) => `${name}=${value}`);
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.join("; ");
}

const shirt = { name: "White linen shirt", category: "top", colors: ["white"] };

describe("GET /health", () => {
  it("responds with ok without a session", async () => {
    const res = await (await setup()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("auth", () => {
  it("rejects sign-up with a short password", async () => {
    const res = await (await setup()).inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Test User", email: "short@example.com", password: "123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("signs in an existing user", async () => {
    const server = await setup();
    await signUp(server, "anna@example.com");

    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "anna@example.com", password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.length).toBeGreaterThan(0);
  });

  it("rejects a wrong password", async () => {
    const server = await setup();
    await signUp(server, "anna@example.com");

    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "anna@example.com", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("/api/items", () => {
  it("requires a session", async () => {
    const server = await setup();
    const list = await server.inject({ method: "GET", url: "/api/items" });
    const create = await server.inject({ method: "POST", url: "/api/items", payload: shirt });
    expect(list.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
  });

  it("creates an item and lists it", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");

    const created = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: shirt,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json<Item>().seasons).toEqual([]);

    const list = await server.inject({ method: "GET", url: "/api/items", headers: { cookie } });
    expect(list.json<Item[]>()).toHaveLength(1);
  });

  it("shows each user only their own items", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");

    await server.inject({ method: "POST", url: "/api/items", headers: { cookie: anna }, payload: shirt });

    const mayas = await server.inject({ method: "GET", url: "/api/items", headers: { cookie: maya } });
    expect(mayas.json<Item[]>()).toEqual([]);
  });

  it("rejects an unknown category", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");

    const res = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { name: "Cape", category: "cape", colors: ["black"] },
    });
    expect(res.statusCode).toBe(400);
  });
});
