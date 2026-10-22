import type { Item, StyledEntry, Usage, WearWithRequest, Wish } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import type { OutfitJobDeps } from "../src/modules/outfits/outfit-jobs";
import { deleteUnattachedPhotos, type PhotoJobDeps } from "../src/modules/photos/photo-jobs";
import type { ItemEmbedder } from "../src/ai/item-embedder";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  createStubRemover,
  createStubEmbedder,
  createStubStylist,
  createStubTagger,
  shirtTags,
  unitVector,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup({
  stylistEnabled = true,
  embedder = null,
}: { stylistEnabled?: boolean; embedder?: ItemEmbedder | null } = {}) {
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
    embedder,
    catalog: repositories.catalogRepository,
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
    // The stub puts the second skirt with the skirt in two looks: no top, so not a look.
    expect(done.outfits.map((o) => o.caption)).toEqual(["Look 1", "Look 3"]);
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
    // No embedding for the item, so nothing to pick partner pieces by.
    expect(call!.shop).toBeNull();
  });

  it("finishes at most two looks with a partner piece, labelled and counted as shown", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    await addItem(s, anna, "top");
    const boots = await s.repositories.catalogRepository.add({ category: "shoes" });
    // A dress would replace the look rather than finish it: never offered.
    await s.repositories.catalogRepository.add({ category: "dress" });

    const { id } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();
    await s.runJobs();

    const [call] = s.stub.composeCalls;
    expect(call!.shop!.pieces).toEqual([
      expect.objectContaining({ n: 4, name: "Ankle boots", category: "shoes" }),
    ]);
    const done = (
      await s.server.inject({
        method: "GET",
        url: `/api/wear-with/${id}?lang=ru`,
        headers: { cookie: anna.cookie },
      })
    ).json<WearWithRequest>();
    const partners = done.outfits.map(
      (o) => o.pieces.find((p) => p.catalogItem)?.catalogItem?.name ?? null,
    );
    // Asked for in three looks and made up in the last: kept in the first two only.
    expect(partners).toEqual(["Ботинки", "Ботинки", null, null]);
    // The boots fill the shoes the first look said it lacked.
    expect(done.outfits[0]!.missing).toBeNull();
    expect(s.repositories.catalogRepository.events).toEqual([
      { catalogItemId: boots.id, userId: anna.userId, event: "shown" },
      { catalogItemId: boots.id, userId: anna.userId, event: "shown" },
    ]);
  });

  it("keeps a wardrobe piece the model took off the sheet, and drops a look without a bottom", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const top = await addItem(s, anna, "top");
    // More tops than the sheet has room for next to a top: some stay off it.
    const tops = [];
    for (let i = 0; i < 6; i++) tops.push(await addItem(s, anna, "top"));
    const offSheet = tops.at(-1)!;
    const skirt = await addItem(s, anna, "bottom");
    s.stub.stylist.compose = async (input) => {
      const skirtN = input.wardrobe.find((p) => p.name === skirt.name)!.n;
      const lastTop = input.wardrobe.find((p) => p.name === offSheet.name)!.n;
      const look = (items: number[], caption: string) => ({
        items,
        partner: null,
        missing: null,
        caption,
        occasion: "coffee",
        why: "because",
      });
      return {
        looks: [
          look([skirtN, lastTop], "Skirt"),
          look([lastTop], "Two tops"),
          look([skirtN, 999], "Made up"),
        ],
        verdict: null,
        costMicros: 6_000,
      };
    };

    const { id } = (await ask(s, anna.cookie, top.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    expect(done.outfits.map((o) => [o.caption, o.pieces.map((p) => p.item?.name)])).toEqual([
      ["Skirt", [top.name, skirt.name, offSheet.name]],
      ["Made up", [top.name, skirt.name]],
    ]);
  });

  it("tells the model what her recent looks already used", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    const top = await addItem(s, anna, "top");
    const jeans = await addItem(s, anna, "bottom");

    await ask(s, anna.cookie, skirt.id);
    await s.runJobs();
    expect(s.stub.composeCalls[0]!.recent).toEqual({ pieces: [], captions: [] });

    await ask(s, anna.cookie, jeans.id);
    await s.runJobs();
    const second = s.stub.composeCalls[1]!;
    // The top was in two of the first request's looks; the skirt asked about doesn't count.
    const topN = second.wardrobe.find((p) => p.name === top.name)!.n;
    expect(second.recent.pieces).toEqual([{ n: topN, looks: 2 }]);
    // Looks 2 and 4 put the jeans with the skirt: no top, so not kept.
    expect(second.recent.captions).toEqual(["Look 1", "Look 3"]);
  });

  it("waits for an item saved a moment ago whose photo is still processing", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    await addItem(s, anna, "top");
    const key = `photos/${anna.userId}/fresh.webp`;
    await s.repositories.photosRepository.create({
      key,
      ownerId: anna.userId,
      uploadKey: "uploads/x",
      tagStatus: null,
    });
    const fresh = (
      await s.server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: anna.cookie },
        payload: { name: "Fresh skirt", category: "bottom", colors: ["white"], photoKey: key },
      })
    ).json<Item>();
    const { id } = (await ask(s, anna.cookie, fresh.id)).json<{ id: string }>();

    // The queue retries a plain error; a permanent one would mark the request failed.
    await expect(s.runJobs()).rejects.toThrow("not ready yet");
    expect((await view(s, anna.cookie, id)).status).toBe("pending");

    await s.storage.put(key, await picture, "image/webp");
    await s.repositories.photosRepository.markReady(key);
    await s.queue.outfitQueue.enqueueComposing(id, "en");
    await s.runJobs();
    expect((await view(s, anna.cookie, id)).status).toBe("done");
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

    // A new brief (her taste changed) composes again too.
    await s.repositories.outfitsRepository.saveBrief(anna.userId, "New taste", {
      itemCount: 2,
      reactionCount: 0,
      inspirationCount: 3,
    });
    expect((await ask(s, anna.cookie, skirt.id)).statusCode).toBe(202);
    await s.runJobs();

    await addItem(s, anna, "top");
    expect((await ask(s, anna.cookie, skirt.id)).statusCode).toBe(202);
  });

  it("composes in the mood asked for, and reuses only the same mood", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await addItem(s, anna, "top");
    const askIn = (mood?: string) =>
      s.server.inject({
        method: "POST",
        url: "/api/wear-with",
        headers: { cookie: anna.cookie },
        payload: mood ? { itemId: skirt.id, mood } : { itemId: skirt.id },
      });

    const evening = (await askIn("evening")).json<{ id: string }>().id;
    await s.runJobs();
    expect(s.stub.composeCalls.at(-1)!.mood).toBe("evening");
    expect((await askIn("evening")).json<{ id: string }>().id).toBe(evening);
    // Another mood, or none, is a new request.
    expect((await askIn("office")).statusCode).toBe(202);
    expect((await askIn()).statusCode).toBe(202);
    await s.runJobs();
    expect(s.stub.composeCalls.at(-1)!.mood).toBeNull();
    expect((await askIn("rave")).statusCode).toBe(400);
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

describe("GET /api/wear-with", () => {
  it("lists the styled items newest first, without deleted ones or other people's", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const boris = await signUp(s, "boris@example.com");
    const skirt = await addItem(s, anna, "bottom");
    const top = await addItem(s, anna, "top");
    await ask(s, anna.cookie, skirt.id);
    await ask(s, anna.cookie, top.id);
    // Still composing: not listed yet.
    const list = async (cookie: string) =>
      (await s.server.inject({ method: "GET", url: "/api/wear-with", headers: { cookie } })).json<
        StyledEntry[]
      >();
    expect(await list(anna.cookie)).toEqual([]);

    await s.runJobs();
    const styled = await list(anna.cookie);
    expect(styled.map((e) => e.name)).toEqual([top.name, skirt.name]);
    expect(styled[0]!.mood).toBeNull();
    expect(styled[0]!.photoUrl).toContain(top.id);
    expect(await list(boris.cookie)).toEqual([]);

    await s.server.inject({
      method: "DELETE",
      url: `/api/items/${top.id}`,
      headers: { cookie: anna.cookie },
    });
    expect((await list(anna.cookie)).map((e) => e.name)).toEqual([skirt.name]);
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
    // No embedding without an embedder: nothing to weigh it against, and no twin.
    expect(s.stub.composeCalls[0]!.buying).toEqual({ closest: [] });
    expect(done.verdict).toEqual({
      call: "think",
      reason: "Close to a piece you own.",
      twin: null,
    });

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

  it("weighs a piece she may buy against the closest she owns, and names its twin", async () => {
    // Every photo embeds alike, so the jeans she owns are as close as can be.
    const s = await setup({ embedder: createStubEmbedder().embedder });
    const anna = await signUp(s, "anna@example.com");
    await addItem(s, anna, "top");
    const jeans = await addItem(s, anna, "bottom");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    const { photoKey } = (await uploadWear(s, anna.cookie)).json<{ photoKey: string }>();
    await s.runPhotoJobs();
    const { id } = (
      await s.server.inject({
        method: "POST",
        url: "/api/wear-with",
        headers: { cookie: anna.cookie },
        payload: { photoKey, index: 1 },
      })
    ).json<{ id: string }>();
    await s.runJobs();

    const call = s.stub.composeCalls[0]!;
    const jeansN = call.wardrobe.find((p) => p.name === jeans.name)!.n;
    expect(call.buying).toEqual({
      closest: [{ n: jeansN, similarity: expect.closeTo(1) as number }],
    });
    const done = await view(s, anna.cookie, id);
    expect(done.verdict).toMatchObject({ call: "think", twin: { id: jeans.id } });

    // A twin deleted since is left out; the verdict stays.
    await s.server.inject({
      method: "DELETE",
      url: `/api/items/${jeans.id}`,
      headers: { cookie: anna.cookie },
    });
    expect((await view(s, anna.cookie, id)).verdict).toMatchObject({ call: "think", twin: null });
  });

  it("gives no verdict for a piece she already owns", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await addItem(s, anna, "top");
    const { id } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();
    await s.runJobs();
    expect(s.stub.composeCalls[0]!.buying).toBeNull();
    expect((await view(s, anna.cookie, id)).verdict).toBeNull();
  });

  // Asks for outfits for the jeans of an uploaded "wear" photo and composes them.
  async function styleFromPhoto(s: Setup, cookie: string) {
    const { photoKey } = (await uploadWear(s, cookie)).json<{ photoKey: string }>();
    await s.runPhotoJobs();
    const { id } = (
      await s.server.inject({
        method: "POST",
        url: "/api/wear-with",
        headers: { cookie },
        payload: { photoKey, index: 1 },
      })
    ).json<{ id: string }>();
    await s.runJobs();
    return id;
  }

  it("saves a piece to her wishes once, and asks a week later whether she still wants it", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    await addItem(s, anna, "top");
    const requestId = await styleFromPhoto(s, anna.cookie);
    const wishes = (cookie: string) =>
      s.server.inject({ method: "GET", url: "/api/wishes", headers: { cookie } });
    const save = () =>
      s.server.inject({
        method: "POST",
        url: "/api/wishes",
        headers: { cookie: anna.cookie },
        payload: { requestId },
      });

    const saved = await save();
    expect(saved.statusCode).toBe(201);
    expect(saved.json<Wish>()).toMatchObject({
      requestId,
      name: "Blue wide-leg jeans",
      photoUrl: `/api/wear-with/${requestId}/photo`,
      call: "think",
      due: false,
    });
    // Saving again is the same wish, and the outfits screen knows it.
    expect((await save()).json<Wish>().id).toBe(saved.json<Wish>().id);
    expect((await view(s, anna.cookie, requestId)).wishId).toBe(saved.json<Wish>().id);
    expect((await wishes(anna.cookie)).json<Wish[]>()).toHaveLength(1);

    // A week on: due. "Still" asks again in a week; "no" lets it go.
    const row = s.repositories.wishesRepository.rows[0]!;
    expect(row.askAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    row.askAt = new Date(Date.now() - 1000);
    const [due] = (await wishes(anna.cookie)).json<Wish[]>();
    expect(due!.due).toBe(true);
    const answer = (value: string) =>
      s.server.inject({
        method: "POST",
        url: `/api/wishes/${due!.id}/answer`,
        headers: { cookie: anna.cookie },
        payload: { answer: value },
      });
    expect((await answer("still")).statusCode).toBe(204);
    expect((await wishes(anna.cookie)).json<Wish[]>()[0]!.due).toBe(false);
    expect(row.stillCount).toBe(1);
    expect((await answer("no")).statusCode).toBe(204);
    expect((await wishes(anna.cookie)).json<Wish[]>()).toEqual([]);
    expect((await answer("no")).statusCode).toBe(404);
  });

  it("keeps wishes to their owner, and only for pieces from photos", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const maya = await signUp(s, "maya@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await addItem(s, anna, "top");
    const fromPhoto = await styleFromPhoto(s, anna.cookie);
    const { id: owned } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();

    const save = (cookie: string, requestId: string) =>
      s.server.inject({
        method: "POST",
        url: "/api/wishes",
        headers: { cookie },
        payload: { requestId },
      });
    expect((await save(maya.cookie, fromPhoto)).statusCode).toBe(404);
    expect((await save(anna.cookie, owned)).statusCode).toBe(404);

    const wish = (await save(anna.cookie, fromPhoto)).json<Wish>();
    const theirs = await s.server.inject({
      method: "POST",
      url: `/api/wishes/${wish.id}/answer`,
      headers: { cookie: maya.cookie },
      payload: { answer: "no" },
    });
    expect(theirs.statusCode).toBe(404);
    expect(
      (
        await s.server.inject({
          method: "GET",
          url: "/api/wishes",
          headers: { cookie: maya.cookie },
        })
      ).json(),
    ).toEqual([]);
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
