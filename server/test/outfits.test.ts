import type { Item, Usage, WearWithRequest } from "@closet-ai/shared";
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
  createStubRemover,
  createStubStylist,
  createStubTagger,
  shirtTags,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup({ stylistEnabled = true } = {}) {
  const repositories = createInMemoryRepositories();
  const storage = createMemoryStorage();
  const queue = createManualOutfitQueue();
  const photoQueue = createManualPhotoQueue();
  const stub = createStubStylist();
  const cut = createStubRemover();
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({
    env,
    auth,
    ...repositories,
    photoQueue: photoQueue.photoQueue,
    outfitQueue: queue.outfitQueue,
    storage,
    taggingEnabled: true,
    stylistEnabled,
  });
  const deps: OutfitJobDeps = {
    outfits: repositories.outfitsRepository,
    photos: repositories.photosRepository,
    storage,
    stylist: stub.stylist,
    remover: cut.remover,
    embedder: null,
    queue: queue.outfitQueue,
    clock: () => new Date("2026-10-21T12:00:00Z"),
  };
  const photoDeps: PhotoJobDeps = {
    photos: repositories.photosRepository,
    storage,
    tagger: createStubTagger().tagger,
    embedder: null,
    remover: null,
    queue: photoQueue.photoQueue,
  };
  return {
    server: app,
    repositories,
    storage,
    queue,
    stub,
    cut,
    photoDeps,
    runJobs: () => queue.runAll(deps),
    runPhotoJobs: () => photoQueue.runAll(photoDeps),
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

const picture = sharp({ create: { width: 60, height: 80, channels: 3, background: "#c88" } })
  .webp()
  .toBuffer();

let made = 0;
// A wardrobe item with a ready photo, as if uploaded and processed.
async function addItem(
  { server, repositories, storage }: Setup,
  { cookie, userId }: { cookie: string; userId: string },
  category: Item["category"] = "top",
) {
  const key = `photos/${userId}/p${++made}.webp`;
  await storage.put(key, await picture, "image/webp");
  await repositories.photosRepository.createReady({
    key,
    ownerId: userId,
    tags: { ...shirtTags, category },
  });
  const res = await server.inject({
    method: "POST",
    url: "/api/items",
    headers: { cookie },
    payload: {
      name: `${category} ${made}`,
      category,
      colors: ["white"],
      seasons: ["autumn"],
      photoKey: key,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Item>();
}

const ask = ({ server }: Setup, cookie: string, itemId: string) =>
  server.inject({
    method: "POST",
    url: "/api/wear-with?lang=ru",
    headers: { cookie },
    payload: { itemId },
  });

const view = async ({ server }: Setup, cookie: string, id: string) =>
  (
    await server.inject({ method: "GET", url: `/api/wear-with/${id}`, headers: { cookie } })
  ).json<WearWithRequest>();

describe("POST /api/wear-with", () => {
  it("composes outfits around a wardrobe item in the background", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    const top = await addItem(s, anna, "top");
    await addItem(s, anna, "bottom");

    const res = await ask(s, anna.cookie, skirt.id);
    expect(res.statusCode).toBe(202);
    const { id } = res.json<{ id: string }>();
    expect(await view(s, anna.cookie, id)).toMatchObject({ status: "pending", outfits: [] });

    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    expect(done.status).toBe("done");
    expect(done.outfits).toHaveLength(4);
    const [first] = done.outfits;
    // The item first, then what goes with it; the number the model made up is gone.
    expect(first!.pieces.map((p) => [p.hero, p.item?.id])).toEqual([
      [true, skirt.id],
      [false, top.id],
    ]);
    expect(first).toMatchObject({
      caption: "Look 1",
      missing: { category: "shoes" },
      opinion: null,
      woreCount: 0,
    });

    // The model saw the item apart, and no second skirt on the sheet; in the user's language.
    const [call] = s.stub.composeCalls;
    expect(call!.hero.name).toBe(skirt.name);
    expect(call!.wardrobe.map((p) => p.name)).not.toContain(skirt.name);
    expect(call!).toMatchObject({ lang: "ru", season: "autumn", looks: 4, brief: null });
  });

  it("shows the same outfits again for free while the wardrobe is the same size", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await addItem(s, anna, "top");
    const first = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>().id;
    await s.runJobs();

    const again = await ask(s, anna.cookie, skirt.id);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ id: string }>().id).toBe(first);
    const usage = (
      await s.server.inject({ method: "GET", url: "/api/usage", headers: { cookie: anna.cookie } })
    ).json<Usage>();
    expect(usage.wear_with).toMatchObject({ used: 1, limit: 5 });

    await addItem(s, anna, "top");
    expect((await ask(s, anna.cookie, skirt.id)).statusCode).toBe(202);
  });

  it("is limited to five a day", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const pieces = [];
    for (let i = 0; i < 6; i++) pieces.push(await addItem(s, anna));
    for (const piece of pieces.slice(0, 5))
      expect((await ask(s, anna.cookie, piece.id)).statusCode).toBe(202);
    const sixth = await ask(s, anna.cookie, pieces[5]!.id);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json<{ message: string }>().message).toBe("limit:wear_with");
  });

  it("only works with the user's own item, and only with a stylist", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const maya = await signUp(s, "maya@example.com");
    const skirt = await addItem(s, anna, "bottom");
    expect((await ask(s, maya.cookie, skirt.id)).statusCode).toBe(404);
    const id = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>().id;
    expect(
      (
        await s.server.inject({
          method: "GET",
          url: `/api/wear-with/${id}`,
          headers: { cookie: maya.cookie },
        })
      ).statusCode,
    ).toBe(404);

    await app!.close();
    const off = await setup({ stylistEnabled: false });
    const noa = await signUp(off, "noa@example.com");
    const item = await addItem(off, noa);
    expect((await ask(off, noa.cookie, item.id)).statusCode).toBe(503);
  });
});

describe("reactions", () => {
  it("keep the latest opinion and count every wear", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const maya = await signUp(s, "maya@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await addItem(s, anna, "top");
    const id = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>().id;
    await s.runJobs();
    const outfitId = (await view(s, anna.cookie, id)).outfits[0]!.id;

    const react = (cookie: string, reaction: string) =>
      s.server.inject({
        method: "POST",
        url: `/api/outfits/${outfitId}/reactions`,
        headers: { cookie },
        payload: { reaction },
      });
    expect((await react(anna.cookie, "like")).statusCode).toBe(204);
    expect((await view(s, anna.cookie, id)).outfits[0]).toMatchObject({
      opinion: "like",
      woreCount: 0,
    });
    await react(anna.cookie, "wore");
    await react(anna.cookie, "wore");
    await react(anna.cookie, "none");
    expect((await view(s, anna.cookie, id)).outfits[0]).toMatchObject({
      opinion: null,
      woreCount: 2,
    });
    expect((await react(maya.cookie, "like")).statusCode).toBe(404);
  });
});

describe("style brief", () => {
  it("is written in the background once the wardrobe is big enough, and used from then on", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const pieces = [];
    for (let i = 0; i < 7; i++) pieces.push(await addItem(s, anna, i % 2 ? "bottom" : "top"));

    await ask(s, anna.cookie, pieces[0]!.id);
    await s.runJobs();
    // Seven items: too few to read a taste from.
    expect(s.stub.briefCalls).toHaveLength(0);

    pieces.push(await addItem(s, anna, "bottom"));
    await ask(s, anna.cookie, pieces[1]!.id);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(1);
    expect(s.stub.briefCalls[0]!.wardrobe).toHaveLength(8);
    expect(await s.repositories.outfitsRepository.brief(anna.userId)).toMatchObject({
      brief: "High-low with a wink.",
      itemCount: 8,
      batchId: null,
    });

    // Not stale yet: no new brief; the next outfits read it.
    await ask(s, anna.cookie, pieces[2]!.id);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(1);
    expect(s.stub.composeCalls.at(-1)!.brief).toBe("High-low with a wink.");
  });
});

describe("an item from a photo", () => {
  async function uploadWear({ server }: Setup, cookie: string) {
    const form = new FormData();
    const jpeg = await sharp({
      create: { width: 400, height: 600, channels: 3, background: "#ccc" },
    })
      .jpeg()
      .toBuffer();
    form.append("photo", new Blob([jpeg], { type: "image/jpeg" }), "shot.jpg");
    return server.inject({
      method: "POST",
      url: "/api/photos?kind=wear",
      headers: { cookie },
      payload: form,
    });
  }

  it("crops the picked item, cuts it out by name and styles it from the wardrobe", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const top = await addItem(s, anna, "top");
    const upload = await uploadWear(s, anna.cookie);
    expect(upload.statusCode).toBe(201);
    const { photoKey } = upload.json<{ photoKey: string }>();
    await s.runPhotoJobs();

    // The stub finds a mesh top and wide-leg jeans; the jeans are picked.
    const res = await s.server.inject({
      method: "POST",
      url: "/api/wear-with",
      headers: { cookie: anna.cookie },
      payload: { photoKey, index: 1 },
    });
    expect(res.statusCode).toBe(202);
    const { id } = res.json<{ id: string }>();
    await s.runJobs();

    expect(s.cut.calls).toEqual([expect.objectContaining({ name: "wide-leg jeans" })]);
    const done = await view(s, anna.cookie, id);
    expect(done.status).toBe("done");
    const [hero, other] = done.outfits[0]!.pieces;
    expect(hero).toMatchObject({
      hero: true,
      item: {
        id,
        name: "Blue wide-leg jeans",
        category: "bottom",
        photoUrl: `/api/wear-with/${id}/photo`,
        cutoutUrl: `/api/wear-with/${id}/photo?variant=cutout`,
      },
    });
    expect(other!.item!.id).toBe(top.id);
    expect(s.stub.composeCalls[0]!.hero.name).toBe("Blue wide-leg jeans");
    expect(done.addable).toMatchObject({ name: "Blue wide-leg jeans", category: "bottom" });

    const picture = await s.server.inject({
      method: "GET",
      url: hero!.item!.cutoutUrl!,
      headers: { cookie: anna.cookie },
    });
    expect(picture.statusCode).toBe(200);
    expect(picture.headers["content-type"]).toBe("image/webp");

    // Bought it: added to the wardrobe with its crop, and no longer offered.
    const added = await s.server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie: anna.cookie },
      payload: done.addable!,
    });
    expect(added.statusCode).toBe(201);
    expect((await view(s, anna.cookie, id)).addable).toBeNull();
  });

  it("keeps the crop through the cleanup, and not the uploaded photo", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    await addItem(s, anna, "top");
    const { photoKey } = (await uploadWear(s, anna.cookie)).json<{ photoKey: string }>();
    await s.runPhotoJobs();
    const { id } = (
      await s.server.inject({
        method: "POST",
        url: "/api/wear-with",
        headers: { cookie: anna.cookie },
        payload: { photoKey, index: 0 },
      })
    ).json<{ id: string }>();
    await s.runJobs();

    await deleteUnattachedPhotos(s.photoDeps, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    expect(await s.repositories.photosRepository.get(photoKey)).toBeNull();
    const done = await view(s, anna.cookie, id);
    const picture = await s.server.inject({
      method: "GET",
      url: done.outfits[0]!.pieces[0]!.item!.photoUrl!,
      headers: { cookie: anna.cookie },
    });
    expect(picture.statusCode).toBe(200);
  });

  it("refuses someone else's photo, a missing item, and uploads once today's outfits are used", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const maya = await signUp(s, "maya@example.com");
    const { photoKey } = (await uploadWear(s, anna.cookie)).json<{ photoKey: string }>();
    await s.runPhotoJobs();
    const ask = (cookie: string, index: number) =>
      s.server.inject({
        method: "POST",
        url: "/api/wear-with",
        headers: { cookie },
        payload: { photoKey, index },
      });
    expect((await ask(maya.cookie, 0)).statusCode).toBe(404);
    expect((await ask(anna.cookie, 7)).statusCode).toBe(400);

    for (let i = 0; i < 5; i++) expect((await ask(anna.cookie, 0)).statusCode).toBe(202);
    expect((await uploadWear(s, anna.cookie)).statusCode).toBe(429);
  });
});
