import { fileURLToPath } from "node:url";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Item } from "@closet-ai/shared";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import type { Env } from "../src/config/env";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createItemsRepository } from "../src/modules/items/items.repository";
import { createMemoryStorage } from "../src/storage/storage";

// The same app as in production, on a real Postgres: Drizzle queries, the Better Auth
// Drizzle adapter and the committed migrations. Runs only when TEST_DATABASE_URL is set
// (always in CI); app.test.ts covers the HTTP behaviour without a database.
const url = process.env.TEST_DATABASE_URL;

// GitHub Actions sets CI=true: there a missing URL is a broken workflow, not a reason to skip.
if (!url && process.env.CI) {
  it("has TEST_DATABASE_URL in CI", () => {
    throw new Error("TEST_DATABASE_URL is not set; the Postgres tests would be skipped");
  });
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

describe.skipIf(!url)("on Postgres", () => {
  let db: ReturnType<typeof createDb>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const storage = createMemoryStorage();

  beforeAll(async () => {
    // The database is wiped below, so refuse anything that isn't clearly a test database.
    if (!new URL(url!).pathname.endsWith("_test")) {
      throw new Error("TEST_DATABASE_URL must point at a database whose name ends in _test");
    }
    db = createDb(url!);
    // Start from an empty database, then apply the committed migrations.
    await db.db.execute("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await db.db.execute("DROP SCHEMA IF EXISTS public CASCADE");
    await db.db.execute("CREATE SCHEMA public");
    await migrate(db.db, { migrationsFolder });

    const env: Env = {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 0,
      LOG_LEVEL: "silent",
      DATABASE_URL: url!,
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
      BETTER_AUTH_URL: "http://localhost:3000",
      S3_ENDPOINT: "http://localhost:8333",
      S3_REGION: "auto",
      S3_BUCKET: "unused",
      S3_ACCESS_KEY_ID: "unused",
      S3_SECRET_ACCESS_KEY: "unused",
    };
    const auth = createAuth(env, drizzleAdapter(db.db, { provider: "pg", schema }));
    // Photo processing is covered in photos.test.ts; here storage is only a stand-in.
    app = await buildApp({
      env,
      auth,
      itemsRepository: createItemsRepository(db.db),
      storage,
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  async function signUp(email: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { name: "Test User", email, password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(200);
    return res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  }

  const shirt = { name: "White linen shirt", category: "top", colors: ["white"] };

  it("signs up, stores an item and lists it back", async () => {
    const cookie = await signUp("anna@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { ...shirt, seasons: ["summer"] },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/api/items", headers: { cookie } });
    expect(list.json<Item[]>()).toEqual([created.json<Item>()]);
  });

  it("keeps a session across sign-in", async () => {
    await signUp("maya@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "maya@example.com", password: "correct-horse-battery" },
    });
    const cookie = res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");

    const list = await app.inject({ method: "GET", url: "/api/items", headers: { cookie } });
    expect(list.statusCode).toBe(200);
  });

  it("shows each user only their own items", async () => {
    const owner = await signUp("owner@example.com");
    const other = await signUp("other@example.com");
    await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie: owner },
      payload: shirt,
    });

    const list = await app.inject({ method: "GET", url: "/api/items", headers: { cookie: other } });
    expect(list.json<Item[]>()).toEqual([]);
  });

  it("stores the photo key and serves the photo by item id", async () => {
    const cookie = await signUp("photo@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "photo@example.com"));
    const photoKey = `photos/${user!.id}/test.webp`;
    await storage.put(photoKey, new Uint8Array([1, 2, 3]), "image/webp");

    const created = await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { ...shirt, photoKey },
    });
    const { photoUrl } = created.json<Item>();
    const photo = await app.inject({ method: "GET", url: photoUrl!, headers: { cookie } });
    expect(photo.statusCode).toBe(200);
    expect([...photo.rawPayload]).toEqual([1, 2, 3]);
  });

  it("deletes only the caller's own item", async () => {
    const owner = await signUp("deleting@example.com");
    const other = await signUp("intruder@example.com");
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: owner },
        payload: shirt,
      })
    ).json<Item>();

    const foreign = await app.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie: other },
    });
    expect(foreign.statusCode).toBe(404);

    const own = await app.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie: owner },
    });
    expect(own.statusCode).toBe(204);
    const left = await db.db.select().from(schema.items).where(eq(schema.items.id, id));
    expect(left).toEqual([]);
  });

  it("deletes a user's items together with the user", async () => {
    const cookie = await signUp("leaving@example.com");
    await app.inject({ method: "POST", url: "/api/items", headers: { cookie }, payload: shirt });
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "leaving@example.com"));

    await db.db.delete(schema.user).where(eq(schema.user.id, user!.id));

    const left = await db.db.select().from(schema.items).where(eq(schema.items.ownerId, user!.id));
    expect(left).toEqual([]);
  });
});
