import type { Inspiration } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import type { OutfitJobDeps } from "../src/modules/outfits/outfit-jobs";
import { deleteUnattachedPhotos, type PhotoJobDeps } from "../src/modules/photos/photo-jobs";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  createStubStylist,
  createStubTagger,
  shirtTags,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup() {
  const repositories = createInMemoryRepositories();
  const storage = createMemoryStorage();
  const outfitQueue = createManualOutfitQueue();
  const photoQueue = createManualPhotoQueue();
  const stub = createStubStylist();
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({
    env,
    auth,
    ...repositories,
    photoQueue: photoQueue.photoQueue,
    outfitQueue: outfitQueue.outfitQueue,
    storage,
    taggingEnabled: true,
    stylistEnabled: true,
  });
  const photoDeps: PhotoJobDeps = {
    photos: repositories.photosRepository,
    storage,
    tagger: createStubTagger().tagger,
    embedder: null,
    remover: null,
    queue: photoQueue.photoQueue,
  };
  const outfitDeps: OutfitJobDeps = {
    outfits: repositories.outfitsRepository,
    photos: repositories.photosRepository,
    storage,
    stylist: stub.stylist,
    remover: null,
    embedder: null,
    catalog: repositories.catalogRepository,
    queue: outfitQueue.outfitQueue,
    clock: () => clock.now,
  };
  // Moved on by tests: a brief is written at most once a day.
  const clock = { now: new Date("2026-10-21T12:00:00Z") };
  return {
    clock,
    server: app,
    repositories,
    storage,
    photoQueue,
    outfitQueue,
    stub,
    photoDeps,
    outfitDeps,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

afterEach(async () => {
  await app?.close();
});

async function signUp({ server }: Setup, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: "correct-horse-battery" },
  });
  const cookie = res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const session = await server.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie },
  });
  return { cookie, userId: session.json<{ user: { id: string } }>().user.id };
}

const jpeg = sharp({ create: { width: 300, height: 500, channels: 3, background: "#d9c" } })
  .jpeg()
  .toBuffer();

async function save({ server }: Setup, cookie: string) {
  const form = new FormData();
  form.append("photo", new Blob([await jpeg], { type: "image/jpeg" }), "look.jpg");
  return server.inject({
    method: "POST",
    url: "/api/photos?kind=inspiration",
    headers: { cookie },
    payload: form,
  });
}

const list = async ({ server }: Setup, cookie: string) =>
  (await server.inject({ method: "GET", url: "/api/inspiration", headers: { cookie } })).json<
    Inspiration[]
  >();

describe("inspiration", () => {
  it("keeps saved looks, unread by any model, and lists them newest first to their owner", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const maya = await signUp(s, "maya@example.com");
    const first = (await save(s, anna.cookie)).json<{ photoKey: string }>().photoKey;
    const second = (await save(s, anna.cookie)).json<{ photoKey: string }>().photoKey;
    // Only processing: no tagging, no cut-out.
    expect(s.photoQueue.queued.map((job) => job.name)).toEqual(["process", "process"]);
    await s.photoQueue.runAll(s.photoDeps);

    const saved = await list(s, anna.cookie);
    expect(saved.map((look) => look.key)).toEqual([second, first]);
    expect(await list(s, maya.cookie)).toEqual([]);

    const own = await s.server.inject({
      method: "GET",
      url: saved[0]!.url,
      headers: { cookie: anna.cookie },
    });
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("image/webp");
    const other = await s.server.inject({
      method: "GET",
      url: saved[0]!.url,
      headers: { cookie: maya.cookie },
    });
    expect(other.statusCode).toBe(404);

    // The hourly cleanup leaves them alone.
    await deleteUnattachedPhotos(s.photoDeps, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect(await list(s, anna.cookie)).toHaveLength(2);
  });

  it("deletes a look for its owner only", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const maya = await signUp(s, "maya@example.com");
    const key = (await save(s, anna.cookie)).json<{ photoKey: string }>().photoKey;
    await s.photoQueue.runAll(s.photoDeps);
    const remove = (cookie: string) =>
      s.server.inject({
        method: "DELETE",
        url: `/api/inspiration?key=${encodeURIComponent(key)}`,
        headers: { cookie },
      });

    expect((await remove(maya.cookie)).statusCode).toBe(404);
    expect((await remove(anna.cookie)).statusCode).toBe(204);
    expect(await list(s, anna.cookie)).toEqual([]);
    expect(await s.storage.get(key)).toBeNull();
  });

  it("rewrites the style brief from the saved looks after a few new ones", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    for (let i = 0; i < 8; i++) {
      const key = `photos/${anna.userId}/item-${i}.webp`;
      await s.storage.put(
        key,
        await sharp(await jpeg)
          .webp()
          .toBuffer(),
        "image/webp",
      );
      await s.repositories.photosRepository.createReady({
        key,
        ownerId: anna.userId,
        tags: shirtTags,
      });
      await s.server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: anna.cookie },
        payload: { name: `Item ${i}`, category: "top", colors: ["white"], photoKey: key },
      });
    }
    // A first brief, written from the wardrobe alone.
    await s.outfitQueue.outfitQueue.enqueueBrief(anna.userId);
    await s.outfitQueue.runAll(s.outfitDeps);
    expect(s.stub.briefCalls).toHaveLength(1);
    expect(s.stub.briefCalls[0]!.inspiration).toHaveLength(0);

    for (let i = 0; i < 2; i++) await save(s, anna.cookie);
    await s.photoQueue.runAll(s.photoDeps);
    await s.outfitQueue.runAll(s.outfitDeps);
    // Two new looks: not yet.
    expect(s.stub.briefCalls).toHaveLength(1);

    s.clock.now = new Date("2026-10-22T13:00:00Z");
    await save(s, anna.cookie);
    await s.photoQueue.runAll(s.photoDeps);
    await s.outfitQueue.runAll(s.outfitDeps);
    expect(s.stub.briefCalls).toHaveLength(2);
    expect(s.stub.briefCalls[1]!.inspiration).toHaveLength(3);
    expect(await s.repositories.outfitsRepository.brief(anna.userId)).toMatchObject({
      inspirationCount: 3,
    });
  });
});
