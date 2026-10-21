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
import { createOutfitsRepository } from "../src/modules/outfits/outfits.repository";
import { createUsageRepository } from "../src/modules/usage/usage.repository";
import { createPhotosRepository } from "../src/modules/photos/photos.repository";
import { createMemoryStorage } from "../src/storage/storage";
import { createManualOutfitQueue, createManualPhotoQueue, shirtTags, unitVector } from "./helpers";

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
      REDIS_URL: "redis://localhost:6379",
      AI_DAILY_BUDGET_USD: 3,
      MODEL_CACHE_DIR: ".models",
    };
    const auth = createAuth(env, drizzleAdapter(db.db, { provider: "pg", schema }));
    // Photo processing is covered in photos.test.ts; here storage is only a stand-in.
    app = await buildApp({
      env,
      auth,
      itemsRepository: createItemsRepository(db.db),
      photosRepository: createPhotosRepository(db.db),
      usageRepository: createUsageRepository(db.db),
      outfitsRepository: createOutfitsRepository(db.db),
      photoQueue: createManualPhotoQueue().photoQueue,
      outfitQueue: createManualOutfitQueue().outfitQueue,
      stylistEnabled: false,
      taggingEnabled: false,
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

  it("stores the photo key and serves the photo by item id once it is ready", async () => {
    const cookie = await signUp("photo@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "photo@example.com"));
    const photos = createPhotosRepository(db.db);
    const photoKey = `photos/${user!.id}/test.webp`;
    await photos.create({
      key: photoKey,
      ownerId: user!.id,
      uploadKey: `uploads/${user!.id}/test`,
      tagStatus: "pending",
    });
    await storage.put(photoKey, new Uint8Array([1, 2, 3]), "image/webp");
    // Tags go into a jsonb column and must come back exactly as written.
    await photos.setTags(photoKey, shirtTags);
    expect(await photos.get(photoKey)).toMatchObject({ tagStatus: "done", tags: shirtTags });
    await photos.markReady(photoKey);

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

  it("updates only the caller's own item, and only the fields sent", async () => {
    const owner = await signUp("editing@example.com");
    const other = await signUp("editing-intruder@example.com");
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: owner },
        payload: shirt,
      })
    ).json<Item>();

    const foreign = await app.inject({
      method: "PATCH",
      url: `/api/items/${id}`,
      headers: { cookie: other },
      payload: { name: "Mine now" },
    });
    expect(foreign.statusCode).toBe(404);

    const own = await app.inject({
      method: "PATCH",
      url: `/api/items/${id}`,
      headers: { cookie: owner },
      payload: { seasons: ["summer", "spring"], colors: ["white", "blue"] },
    });
    expect(own.json<Item>()).toMatchObject({
      name: shirt.name,
      seasons: ["summer", "spring"],
      colors: ["white", "blue"],
      tags: null,
    });
  });

  it("reads and deletes only the caller's own item", async () => {
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

    const read = await app.inject({
      method: "GET",
      url: `/api/items/${id}`,
      headers: { cookie: owner },
    });
    expect(read.json<Item>().id).toBe(id);
    const hidden = await app.inject({
      method: "GET",
      url: `/api/items/${id}`,
      headers: { cookie: other },
    });
    expect(hidden.statusCode).toBe(404);

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

  it("finds similar items with pgvector, same category, closest first", async () => {
    const cookie = await signUp("similar@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "similar@example.com"));
    const photos = createPhotosRepository(db.db);
    const add = async (name: string, category: string, vector: number[]) => {
      const key = `photos/${user!.id}/${name}.webp`;
      await photos.create({
        key,
        ownerId: user!.id,
        uploadKey: `uploads/${user!.id}/${name}`,
        tagStatus: null,
      });
      await photos.markReady(key);
      await photos.setEmbedding(key, vector);
      return (
        await app.inject({
          method: "POST",
          url: "/api/items",
          headers: { cookie },
          payload: { name, category, colors: ["white"], photoKey: key },
        })
      ).json<Item>().id;
    };
    const shirt = await add("shirt", "top", unitVector(1, 0));
    await add("close", "top", unitVector(1, 0.2));
    await add("far", "top", unitVector(0.2, 1));
    await add("shorts", "bottom", unitVector(1, 0));

    const res = await app.inject({
      method: "GET",
      url: `/api/items/${shirt}/similar`,
      headers: { cookie },
    });
    const found = res.json<(Item & { similarity: number })[]>();
    expect(found.map((item) => item.name)).toEqual(["close", "far"]);
    expect(found[0]!.similarity).toBeCloseTo(0.98, 2);
    expect(await photos.listWithoutEmbedding()).not.toContain(`photos/${user!.id}/shirt.webp`);

    // "Want / Can" asks the same index with a look item's vector instead of an item's.
    const closest = await photos.closestItems(user!.id, "top", unitVector(0.2, 1), 2);
    expect(closest.map((item) => item.name)).toEqual(["far", "close"]);
    expect(closest[0]).toMatchObject({ photoKey: `photos/${user!.id}/far.webp`, cutoutKey: null });
    expect(closest[0]!.similarity).toBeCloseTo(1, 5);
  });

  it("stores a want look's items with their matches", async () => {
    await signUp("want@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "want@example.com"));
    const photos = createPhotosRepository(db.db);
    const key = `photos/${user!.id}/want.webp`;
    await photos.create({
      key,
      ownerId: user!.id,
      uploadKey: `uploads/${user!.id}/want`,
      kind: "want",
      tagStatus: "pending",
    });
    const box = { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };
    const { recognized: _recognized, ...tags } = shirtTags;
    await photos.setLookItems(key, [{ ...tags, box, noun: null }], [{ how: "none", itemId: null }]);
    expect(await photos.get(key)).toMatchObject({
      kind: "want",
      tagStatus: "done",
      matches: [{ how: "none", itemId: null }],
    });
  });

  it("stores the cut-out key and gives the item a cut-out URL", async () => {
    const cookie = await signUp("cutout@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "cutout@example.com"));
    const photos = createPhotosRepository(db.db);
    const key = `photos/${user!.id}/cut.webp`;
    await photos.create({
      key,
      ownerId: user!.id,
      uploadKey: `uploads/${user!.id}/cut`,
      tagStatus: null,
    });
    await photos.markReady(key);
    expect(await photos.listWithoutCutout()).toContain(key);
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name: "cut", category: "top", colors: ["white"], photoKey: key },
      })
    ).json<Item>();

    await photos.setCutout(key, `photos/${user!.id}/cut-cutout.webp`);
    expect(await photos.listWithoutCutout()).not.toContain(key);
    const item = (
      await app.inject({ method: "GET", url: `/api/items/${id}`, headers: { cookie } })
    ).json<Item>();
    expect(item.cutoutUrl).toMatch(new RegExp(`^/api/items/${id}/photo\\?variant=cutout&v=`));
  });

  it("copies a photo under new keys and points the item at the copy", async () => {
    const cookie = await signUp("turn@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "turn@example.com"));
    const photos = createPhotosRepository(db.db);
    const key = `photos/${user!.id}/before.webp`;
    await photos.create({
      key,
      ownerId: user!.id,
      uploadKey: `uploads/${user!.id}/b`,
      tagStatus: "pending",
    });
    await photos.markReady(key);
    await photos.setTags(key, shirtTags);
    const { id } = (
      await app.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name: "turn", category: "top", colors: ["white"], photoKey: key },
      })
    ).json<Item>();

    const turned = `photos/${user!.id}/after.webp`;
    await photos.copyAs(key, { key: turned, cutoutKey: `photos/${user!.id}/after-cutout.webp` });
    const items = createItemsRepository(db.db);
    expect(await items.setPhotoKey(user!.id, id, turned)).toBe(true);
    expect(await items.setPhotoKey("someone-else", id, key)).toBe(false);
    await photos.delete(key);

    expect(await photos.get(turned)).toMatchObject({
      status: "ready",
      tags: shirtTags,
      cutoutKey: `photos/${user!.id}/after-cutout.webp`,
    });
    expect(await items.photoKey(user!.id, id, "photo")).toBe(turned);
  });

  it("counts usage per user and action, and sums the spend", async () => {
    await signUp("usage@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "usage@example.com"));
    const usage = createUsageRepository(db.db);
    const before = new Date(Date.now() - 1000);
    const spentBefore = await usage.spentSince(before);
    await usage.record(user!.id, "want", 10_000);
    await usage.record(user!.id, "want", 10_000);
    await usage.record(user!.id, "item_photo", 6_000);

    expect(await usage.count(user!.id, "want", before)).toBe(2);
    expect(await usage.count(user!.id, "look", before)).toBe(0);
    expect(await usage.count(user!.id, "want", new Date(Date.now() + 60_000))).toBe(0);
    expect((await usage.spentSince(before)) - spentBefore).toBe(26_000);
  });

  it("stores outfits with their pieces and reactions, and the user's brief", async () => {
    const cookie = await signUp("outfits@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "outfits@example.com"));
    const photos = createPhotosRepository(db.db);
    const ids: string[] = [];
    for (const [i, category] of (["bottom", "top"] as const).entries()) {
      const key = `photos/${user!.id}/outfit-${i}.webp`;
      await photos.createReady({ key, ownerId: user!.id, tags: { ...shirtTags, category } });
      const res = await app.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name: category, category, colors: ["white"], photoKey: key },
      });
      ids.push(res.json<Item>().id);
    }
    const [skirt, top] = ids as [string, string];
    const outfits = createOutfitsRepository(db.db);

    expect((await outfits.wardrobe(user!.id)).map((i) => i.id)).toEqual([skirt, top]);
    expect(await outfits.wardrobeSize(user!.id)).toBe(2);
    const requestId = await outfits.createRequest(user!.id, { itemId: skirt }, 2);
    expect(await outfits.latestDone(user!.id, skirt)).toBeNull();
    await outfits.saveOutfits(
      requestId,
      user!.id,
      [
        {
          caption: "Tee and satin",
          occasion: "coffee",
          why: "high-low",
          missing: { category: "shoes", description: "black boots" },
          pieces: [
            { hero: true, itemId: skirt },
            { hero: false, itemId: top },
          ],
        },
      ],
      7_000,
    );
    expect(await outfits.latestDone(user!.id, skirt)).toMatchObject({
      id: requestId,
      wardrobeSize: 2,
    });

    const viewed = await outfits.view(requestId, user!.id);
    expect(await outfits.view(requestId, "someone-else")).toBeNull();
    const outfitId = viewed!.outfits[0]!.id;
    expect(await outfits.react(outfitId, user!.id, "like")).toBe(true);
    expect(await outfits.react(outfitId, "someone-else", "like")).toBe(false);
    await outfits.react(outfitId, user!.id, "wore");
    expect((await outfits.view(requestId, user!.id))!.outfits[0]).toMatchObject({
      caption: "Tee and satin",
      missing: { category: "shoes" },
      pieces: [
        { hero: true, item: { id: skirt } },
        { hero: false, item: { id: top } },
      ],
      opinion: "like",
      woreCount: 1,
    });
    expect(await outfits.reactionCount(user!.id)).toBe(2);
    expect(await outfits.reactedOutfits(user!.id, 5)).toEqual([
      { opinion: "like", wore: true, description: '"Tee and satin": bottom + top' },
    ]);

    // A deleted item leaves the outfit, without that piece.
    await app.inject({ method: "DELETE", url: `/api/items/${top}`, headers: { cookie } });
    expect((await outfits.view(requestId, user!.id))!.outfits[0]!.pieces[1]!.item).toBeNull();

    // A crop an outfit request points to is kept by the cleanup.
    const crop = `photos/${user!.id}/crop.webp`;
    await photos.createReady({ key: crop, ownerId: user!.id, tags: shirtTags });
    const loose = `photos/${user!.id}/loose.webp`;
    await photos.createReady({ key: loose, ownerId: user!.id, tags: shirtTags });
    await outfits.createRequest(user!.id, { heroPhotoKey: crop, heroNoun: "linen shirt" }, 2);
    const unattached = (await photos.listUnattached(new Date(Date.now() + 60_000))).map(
      (p) => p.key,
    );
    expect(unattached).toContain(loose);
    expect(unattached).not.toContain(crop);
    expect(await outfits.isAttached(crop)).toBe(false);

    // A saved look is listed and kept by the cleanup too.
    const look = `photos/${user!.id}/look.webp`;
    await photos.create({
      key: look,
      ownerId: user!.id,
      uploadKey: `uploads/${user!.id}/look`,
      kind: "inspiration",
      tagStatus: null,
    });
    await photos.markReady(look);
    expect((await photos.listInspiration(user!.id)).map((p) => p.key)).toEqual([look]);
    expect(
      (await photos.listUnattached(new Date(Date.now() + 60_000))).map((p) => p.key),
    ).not.toContain(look);
    expect(await outfits.inspirationKeys(user!.id, 5)).toContain(look);

    await outfits.setBriefBatch(user!.id, "batch-1");
    expect(await outfits.brief(user!.id)).toMatchObject({ brief: null, batchId: "batch-1" });
    await outfits.saveBrief(user!.id, "High-low", {
      itemCount: 2,
      reactionCount: 2,
      inspirationCount: 0,
    });
    expect(await outfits.brief(user!.id)).toMatchObject({
      brief: "High-low",
      itemCount: 2,
      batchId: null,
    });
  });

  it("lists only photos no item points to, created before the cutoff", async () => {
    const cookie = await signUp("cleanup@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "cleanup@example.com"));
    const photos = createPhotosRepository(db.db);
    const loose = `photos/${user!.id}/loose.webp`;
    const used = `photos/${user!.id}/used.webp`;
    for (const key of [loose, used]) {
      await photos.create({
        key,
        ownerId: user!.id,
        uploadKey: `uploads/${user!.id}/x`,
        tagStatus: null,
      });
    }
    await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { ...shirt, photoKey: used },
    });

    const later = new Date(Date.now() + 60_000);
    const keys = (await photos.listUnattached(later)).map((photo) => photo.key);
    expect(keys).toContain(loose);
    expect(keys).not.toContain(used);
    expect(await photos.listUnattached(new Date(0))).toEqual([]);
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
