import type { Item, Usage, WearWithRequest } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import type { OutfitJobDeps } from "../src/modules/outfits/outfit-jobs";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  createStubStylist,
  shirtTags,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup({ stylistEnabled = true } = {}) {
  const repositories = createInMemoryRepositories();
  const storage = createMemoryStorage();
  const queue = createManualOutfitQueue();
  const stub = createStubStylist();
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({
    env,
    auth,
    ...repositories,
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: queue.outfitQueue,
    storage,
    taggingEnabled: false,
    stylistEnabled,
  });
  const deps: OutfitJobDeps = {
    outfits: repositories.outfitsRepository,
    storage,
    stylist: stub.stylist,
    queue: queue.outfitQueue,
    clock: () => new Date("2026-10-21T12:00:00Z"),
  };
  return { server: app, repositories, storage, queue, stub, runJobs: () => queue.runAll(deps) };
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
