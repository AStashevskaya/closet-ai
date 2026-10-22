import type { Item } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup() {
  // Better Auth runs for real, backed by its in-memory adapter instead of Postgres.
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({
    env,
    auth,
    ...createInMemoryRepositories(),
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    stylistEnabled: false,
    taggingEnabled: false,
    storage: createMemoryStorage(),
  });
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

describe("errors", () => {
  it("hides the message of unexpected errors", async () => {
    const server = await setup();
    server.get("/boom", () => {
      throw new Error('relation "items" does not exist');
    });

    const res = await server.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("relation");
  });

  it("keeps the message of validation errors", async () => {
    const server = await setup();
    const res = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: "{",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).not.toBe("Internal Server Error");
  });
});

describe("auth", () => {
  it("rejects sign-up with a short password", async () => {
    const res = await (
      await setup()
    ).inject({
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

  it("trusts the app's own scheme as an origin", async () => {
    const res = await (
      await setup()
    ).inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      // A cookie makes Better Auth validate the origin; without one the check is skipped.
      headers: { origin: "closetai://", cookie: "x=1" },
      payload: { name: "Test User", email: "app@example.com", password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects requests from an untrusted website", async () => {
    const res = await (
      await setup()
    ).inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: "https://evil.example.com", cookie: "x=1" },
      payload: { name: "Test User", email: "evil@example.com", password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(403);
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

    await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie: anna },
      payload: shirt,
    });

    const mayas = await server.inject({
      method: "GET",
      url: "/api/items",
      headers: { cookie: maya },
    });
    expect(mayas.json<Item[]>()).toEqual([]);
  });

  it("rejects a color outside the palette", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");

    const res = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { ...shirt, colors: ["sky"] },
    });
    expect(res.statusCode).toBe(400);
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

describe("DELETE /api/items/:id", () => {
  async function createShirt(server: App, cookie: string) {
    const res = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: shirt,
    });
    return res.json<Item>().id;
  }

  it("requires a session", async () => {
    const server = await setup();
    const res = await server.inject({ method: "DELETE", url: `/api/items/${crypto.randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("deletes an item without a photo", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const id = await createShirt(server, cookie);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    const list = await server.inject({ method: "GET", url: "/api/items", headers: { cookie } });
    expect(list.json<Item[]>()).toEqual([]);
  });

  it("answers 404 for an item that is already gone", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const id = await createShirt(server, cookie);
    await server.inject({ method: "DELETE", url: `/api/items/${id}`, headers: { cookie } });

    const again = await server.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie },
    });
    expect(again.statusCode).toBe(404);
  });

  it("does not let one user delete another user's item", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const id = await createShirt(server, anna);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie: maya },
    });
    expect(res.statusCode).toBe(404);

    const annas = await server.inject({
      method: "GET",
      url: "/api/items",
      headers: { cookie: anna },
    });
    expect(annas.json<Item[]>()).toHaveLength(1);
  });

  it("rejects an id that is not a UUID", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const res = await server.inject({
      method: "DELETE",
      url: "/api/items/abc",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/items/:id", () => {
  it("requires a session", async () => {
    const server = await setup();
    const res = await server.inject({ method: "GET", url: `/api/items/${crypto.randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns the caller's item", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const created = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: shirt,
      })
    ).json<Item>();

    const res = await server.inject({
      method: "GET",
      url: `/api/items/${created.id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // No photo, so nothing was tagged.
    expect(res.json<Item>()).toEqual({ ...created, tags: null });
  });

  it("answers 404 for someone else's item", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: anna },
        payload: shirt,
      })
    ).json<Item>();

    const res = await server.inject({
      method: "GET",
      url: `/api/items/${id}`,
      headers: { cookie: maya },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /api/items/:id", () => {
  async function createShirt(server: App, cookie: string) {
    return (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: shirt,
      })
    ).json<Item>();
  }

  it("changes only the fields sent", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const created = await createShirt(server, cookie);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/items/${created.id}`,
      headers: { cookie },
      payload: { name: "  Linen shirt ", seasons: ["summer"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Item>()).toEqual({
      ...created,
      name: "Linen shirt",
      seasons: ["summer"],
      tags: null,
    });

    const list = await server.inject({ method: "GET", url: "/api/items", headers: { cookie } });
    expect(list.json<Item[]>()[0]).toMatchObject({ name: "Linen shirt", category: "top" });
  });

  it("stores brand and price with its currency, and clears them with null", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const created = await createShirt(server, cookie);
    expect(created).toMatchObject({ brand: null, price: null, currency: null });

    const patch = (payload: object) =>
      server.inject({
        method: "PATCH",
        url: `/api/items/${created.id}`,
        headers: { cookie },
        payload,
      });
    const priced = await patch({ brand: " COS ", price: 349.9, currency: "ILS" });
    expect(priced.json<Item>()).toMatchObject({ brand: "COS", price: 349.9, currency: "ILS" });
    // A price on its own would be in no currency at all.
    expect((await patch({ price: 10 })).statusCode).toBe(400);
    expect((await patch({ price: 10.001, currency: "USD" })).statusCode).toBe(400);

    const cleared = await patch({ brand: null, price: null, currency: null });
    expect(cleared.json<Item>()).toMatchObject({ brand: null, price: null, currency: null });
  });

  it("validates like creating does", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { id } = await createShirt(server, cookie);

    for (const payload of [{ name: "  " }, { colors: [] }, { category: "hat" }]) {
      const res = await server.inject({
        method: "PATCH",
        url: `/api/items/${id}`,
        headers: { cookie },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("answers 404 for someone else's item and leaves it alone", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { id } = await createShirt(server, anna);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/items/${id}`,
      headers: { cookie: maya },
      payload: { name: "Mine now" },
    });
    expect(res.statusCode).toBe(404);
    const own = await server.inject({
      method: "GET",
      url: `/api/items/${id}`,
      headers: { cookie: anna },
    });
    expect(own.json<Item>().name).toBe(shirt.name);
  });

  it("requires a session", async () => {
    const server = await setup();
    const res = await server.inject({
      method: "PATCH",
      url: `/api/items/${crypto.randomUUID()}`,
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});
