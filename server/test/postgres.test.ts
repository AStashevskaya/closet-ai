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
import { createCatalogRepository } from "../src/modules/catalog/catalog.repository";
import { createItemsRepository } from "../src/modules/items/items.repository";
import { createWishesRepository } from "../src/modules/wishes/wishes.repository";
import { createProfileRepository } from "../src/modules/profile/profile.repository";
import { createOutfitsRepository } from "../src/modules/outfits/outfits.repository";
import { createUsageRepository } from "../src/modules/usage/usage.repository";
import { kindOf } from "../src/modules/photos/offer-ranker";
import { createPhotosRepository } from "../src/modules/photos/photos.repository";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createManualOutfitQueue,
  createManualPhotoQueue,
  demoCatalogItem,
  shirtTags,
  unitVector,
} from "./helpers";

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
      USER_MONTHLY_BUDGET_USD: 5,
      TESTER_USER_IDS: [],
      MODEL_CACHE_DIR: ".models",
      WORKERS_IN_API: true,
      PARTNER_ITEMS: true,
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
      profileRepository: createProfileRepository(db.db),
      catalogRepository: createCatalogRepository(db.db),
      wishesRepository: createWishesRepository(db.db),
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

  it("saves the profile and updates it in place", async () => {
    const cookie = await signUp("profile@example.com");
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: "/api/profile", headers: { cookie }, payload });
    await patch({ country: "IL", sizeTop: "S" });
    const second = await patch({ sizeTop: "M", bodyShape: "rectangle" });
    expect(second.json()).toMatchObject({ country: "IL", sizeTop: "M", bodyShape: "rectangle" });
  });

  it("deletes the account with everything of theirs, and keeps other users' items", async () => {
    // The database isn't wiped between tests, so these addresses are new.
    const anna = await signUp("leaving@example.com");
    const boris = await signUp("staying@example.com");
    const annaId = (
      await app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie: anna } })
    ).json<{ user: { id: string } }>().user.id;
    for (const cookie of [anna, boris]) {
      await app.inject({ method: "POST", url: "/api/items", headers: { cookie }, payload: shirt });
    }

    const deleted = await app.inject({
      method: "POST",
      url: "/api/auth/delete-user",
      headers: { cookie: anna, origin: "closetai://" },
      payload: { password: "correct-horse-battery" },
    });
    expect(deleted.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/items", headers: { cookie: boris } });
    expect(list.json<Item[]>()).toHaveLength(1);
    // Nothing of hers is left: the rows went with the user (ON DELETE CASCADE).
    const hers = await db.db.select().from(schema.items).where(eq(schema.items.ownerId, annaId));
    expect(hers).toEqual([]);
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
      payload: {
        seasons: ["summer", "spring"],
        colors: ["white", "blue"],
        brand: "COS",
        price: 349.9,
        currency: "ILS",
      },
    });
    expect(own.json<Item>()).toMatchObject({
      name: shirt.name,
      seasons: ["summer", "spring"],
      colors: ["white", "blue"],
      brand: "COS",
      price: 349.9,
      currency: "ILS",
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
    const catalog = createCatalogRepository(db.db);
    // Its own category, so the catalog test's closest items stay its own.
    await catalog.upsert({ ...demoCatalogItem("O1"), category: "outerwear" });
    const [boots] = await catalog.closest("outerwear", unitVector(1), 1);

    expect((await outfits.wardrobe(user!.id)).map((i) => i.id)).toEqual([skirt, top]);
    expect(await outfits.wardrobeSize(user!.id)).toBe(2);
    const requestId = await outfits.createRequest(user!.id, { itemId: skirt }, 2);
    expect(await outfits.latestDone(user!.id, skirt, null)).toBeNull();
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
            { hero: false, itemId: null, catalogItemId: boots!.id, sponsored: true },
          ],
        },
      ],
      { micros: 7_000, tokens: { input: 900, cacheWrite: 4_000, cacheRead: 0, output: 1_200 } },
      { call: "skip", reason: "You have one.", twinItemId: top },
    );
    const [stored] = await db.db
      .select({
        costMicros: schema.outfitRequests.costMicros,
        tokens: schema.outfitRequests.tokens,
      })
      .from(schema.outfitRequests)
      .where(eq(schema.outfitRequests.id, requestId));
    expect(stored).toEqual({
      costMicros: 7_000,
      tokens: { input: 900, cacheWrite: 4_000, cacheRead: 0, output: 1_200 },
    });
    expect((await outfits.getRequest(requestId))!.verdict).toEqual({
      call: "skip",
      reason: "You have one.",
      twinItemId: top,
    });
    expect(await outfits.latestDone(user!.id, skirt, "evening")).toBeNull();
    expect(await outfits.latestDone(user!.id, skirt, null)).toMatchObject({
      id: requestId,
      wardrobeSize: 2,
    });

    const viewed = await outfits.view(requestId, user!.id, "en");
    expect(await outfits.view(requestId, "someone-else", "en")).toBeNull();
    const outfitId = viewed!.outfits[0]!.id;
    expect(await outfits.react(outfitId, user!.id, "like")).toBe(true);
    expect(await outfits.react(outfitId, "someone-else", "like")).toBe(false);
    await outfits.react(outfitId, user!.id, "wore");
    expect((await outfits.view(requestId, user!.id, "en"))!.outfits[0]).toMatchObject({
      caption: "Tee and satin",
      missing: { category: "shoes" },
      pieces: [
        { hero: true, item: { id: skirt }, catalogItem: null },
        { hero: false, item: { id: top }, catalogItem: null },
        { hero: false, item: null, catalogItem: { id: boots!.id, name: "Ankle boots" } },
      ],
      opinion: "like",
      woreCount: 1,
    });
    // A like and a "wore" on one outfit: one outfit reacted to.
    expect(await outfits.reactedOutfitCount(user!.id)).toBe(1);
    expect(await outfits.reactedOutfits(user!.id, 5)).toEqual([
      { opinion: "like", reason: null, wore: true, description: '"Tee and satin": bottom + top' },
    ]);
    // Changed her mind: not hers, the pieces don't go together; the reason round-trips.
    await outfits.react(outfitId, user!.id, "dislike", "match");
    expect((await outfits.view(requestId, user!.id, "en"))!.outfits[0]).toMatchObject({
      opinion: "dislike",
      reason: "match",
    });
    expect((await outfits.reactedOutfits(user!.id, 5))[0]).toMatchObject({
      opinion: "dislike",
      reason: "match",
    });

    // A deleted item leaves the outfit, without that piece.
    await app.inject({ method: "DELETE", url: `/api/items/${top}`, headers: { cookie } });
    expect((await outfits.view(requestId, user!.id, "en"))!.outfits[0]!.pieces[1]!.item).toBeNull();

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

    await outfits.setBriefBatch(user!.id, "batch-1", new Date());
    expect(await outfits.brief(user!.id)).toMatchObject({ brief: null, batchId: "batch-1" });
    const writtenAt = new Date("2026-10-21T12:00:00Z");
    const summary = { en: "High-low", ru: "Дорогое с простым", he: "יוקרה ופשטות" };
    await outfits.saveBrief(
      user!.id,
      { brief: "High-low", summary },
      { itemCount: 2, reactionCount: 1, inspirationCount: 0 },
      writtenAt,
    );
    expect(await outfits.brief(user!.id)).toMatchObject({
      brief: "High-low",
      summary,
      itemCount: 2,
      batchId: null,
      writtenAt,
    });

    // Asking for an update keeps the brief; what she added is counted from a moment on.
    const askedAt = new Date("2026-10-22T09:00:00Z");
    await outfits.askBrief(user!.id, askedAt);
    expect(await outfits.brief(user!.id)).toMatchObject({ brief: "High-low", askedAt });
    expect((await outfits.addedSince(user!.id, new Date(0))).looks).toBe(1);
    expect(await outfits.addedSince(user!.id, new Date(Date.now() + 60_000))).toEqual({
      items: 0,
      looks: 0,
    });

    // A failed batch is dropped but keeps when it was asked for, so the next try waits.
    const requestedAt = new Date("2026-10-22T12:00:00Z");
    await outfits.setBriefBatch(user!.id, "batch-2", requestedAt);
    await outfits.dropBriefBatch(user!.id);
    expect(await outfits.brief(user!.id)).toMatchObject({
      brief: "High-low",
      batchId: null,
      requestedAt,
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

  it("imports catalog items again by feed id and finds the closest in stock", async () => {
    const catalog = createCatalogRepository(db.db);
    await catalog.upsert({ ...demoCatalogItem("C1"), embedding: unitVector(1, 0) });
    await catalog.upsert({ ...demoCatalogItem("C2"), embedding: unitVector(1, 1) });
    await catalog.upsert({ ...demoCatalogItem("C3"), embedding: unitVector(1, 0), inStock: false });
    await catalog.upsert({ ...demoCatalogItem("C4"), category: "bottom" });
    // Imported again with a new price: the same row.
    await catalog.upsert({
      ...demoCatalogItem("C1"),
      embedding: unitVector(1, 0),
      priceMinor: 100,
    });

    const closest = await catalog.closest("shoes", unitVector(1, 0), 5);
    expect(closest.map((row) => row.externalId)).toEqual(["C1", "C2"]);
    expect(closest[0]!.priceMinor).toBe(100);

    const cookie = await signUp("catalog@example.com");
    const res = await app.inject({
      method: "GET",
      url: `/api/catalog/${closest[0]!.id}?lang=ru`,
      headers: { cookie },
    });
    expect(res.json()).toMatchObject({ name: "Ботинки", price: 1, demo: true });
    const events = await db.db
      .select()
      .from(schema.catalogEvents)
      .where(eq(schema.catalogEvents.catalogItemId, closest[0]!.id));
    expect(events.map((e) => e.event)).toEqual(["opened"]);
  });

  it("pools offers: the closest by picture, then the closest of the same kind by name", async () => {
    const catalog = createCatalogRepository(db.db);
    // Its own category, so other tests' catalog items stay out of the pool.
    const add = (externalId: string, en: string, embedding: number[], inStock = true) =>
      catalog.upsert({
        ...demoCatalogItem(externalId),
        category: "accessory",
        names: { en },
        embedding,
        inStock,
      });
    await add("A1", "Bucket hat", unitVector(1, 0));
    await add("A2", "Wool beret", unitVector(0.99, 0.01));
    await add("A3", "Straw basket", unitVector(0.8, 0.6));
    await add("A4", "Leather tote bags", unitVector(1, 0, 1));
    await add("A5", "Bag XL", unitVector(0.6, 0.8));
    await add("A6", "Shoulder bag", unitVector(0.3, 0.7));
    await add("A7", "Clutch bag", unitVector(1, 0), false);

    const pool = await catalog.offerCandidates({
      category: "accessory",
      image: unitVector(1, 0),
      text: unitVector(0, 0, 1),
      kind: kindOf("leather tote bag"),
      byImage: 2,
      byKind: 2,
    });
    // The two closest, then the two closest bags after them (SQL reads "Bag XL" as a bag, as
    // kindOf does); the basket is neither, the clutch is sold out.
    expect(pool.map((row) => row.externalId)).toEqual(["A1", "A2", "A4", "A5"]);
    expect(pool[2]!.similarity).toBeCloseTo(Math.SQRT1_2, 5);
    expect(pool[2]!.textSimilarity).toBeCloseTo(Math.SQRT1_2, 5);
    expect(pool[0]!.textSimilarity).toBeCloseTo(0, 5);

    // Without a kind (a piece named only in Russian), only the closest.
    const plain = await catalog.offerCandidates({
      category: "accessory",
      image: unitVector(1, 0),
      text: unitVector(0, 0, 1),
      kind: "",
      byImage: 2,
      byKind: 2,
    });
    expect(plain.map((row) => row.externalId)).toEqual(["A1", "A2"]);
  });

  it("orders the Edit by closeness to the user's wardrobe as a whole", async () => {
    const cookie = await signUp("edit@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "edit@example.com"));
    const photos = createPhotosRepository(db.db);
    const key = `photos/${user!.id}/edit.webp`;
    await photos.createReady({ key, ownerId: user!.id, tags: shirtTags });
    await photos.setEmbedding(key, unitVector(0, 0, 1));
    await app.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { ...shirt, photoKey: key },
    });
    const catalog = createCatalogRepository(db.db);
    await catalog.upsert({ ...demoCatalogItem("E1"), category: "dress", embedding: unitVector(1) });
    await catalog.upsert({
      ...demoCatalogItem("E2"),
      category: "dress",
      embedding: unitVector(0, 0, 1),
    });

    const rows = await catalog.list(user!.id, "dress", 10);
    expect(rows.map((row) => row.externalId)).toEqual(["E2", "E1"]);
    // Someone with no wardrobe gets the feed's order.
    expect((await catalog.list("nobody", "dress", 10)).map((row) => row.externalId)).toEqual([
      "E1",
      "E2",
    ]);
  });

  it("keeps one wish per request, moves it on, and lets it go", async () => {
    await signUp("wishes@example.com");
    const [user] = await db.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "wishes@example.com"));
    const photos = createPhotosRepository(db.db);
    const crop = `photos/${user!.id}/wish.webp`;
    await photos.createReady({ key: crop, ownerId: user!.id, tags: shirtTags });
    const outfits = createOutfitsRepository(db.db);
    const requestId = await outfits.createRequest(
      user!.id,
      { heroPhotoKey: crop, heroNoun: "shirt" },
      0,
    );
    const wishes = createWishesRepository(db.db);

    const soon = new Date(Date.now() + 1000);
    const saved = await wishes.add(user!.id, requestId, soon);
    expect(saved).toMatchObject({ requestId, name: shirtTags.name, call: null, stillCount: 0 });
    expect((await wishes.add(user!.id, requestId, new Date())).id).toBe(saved.id);
    expect(await wishes.idFor(user!.id, requestId)).toBe(saved.id);

    // Not due yet: "still" doesn't count; once due, it does, and moves it on.
    const later = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    expect(await wishes.keep(user!.id, saved.id, new Date(), later)).toBe("not-due");
    expect(await wishes.keep("someone-else", saved.id, later, later)).toBe("missing");
    expect(await wishes.countDue(user!.id, new Date(Date.now() + 2000))).toBe(1);
    expect(await wishes.keep(user!.id, saved.id, new Date(Date.now() + 2000), later)).toBe("kept");
    expect(await wishes.list(user!.id)).toEqual([
      expect.objectContaining({ id: saved.id, askAt: later, stillCount: 1 }),
    ]);

    // In her closet now: the wish goes.
    await wishes.removeForPhoto("someone-else", crop);
    expect(await wishes.list(user!.id)).toHaveLength(1);
    await wishes.removeForPhoto(user!.id, crop);
    expect(await wishes.list(user!.id)).toEqual([]);
    expect(await wishes.remove(user!.id, saved.id)).toBe(false);
  });
});
