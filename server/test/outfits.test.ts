import type {
  Item,
  StyledEntry,
  StyleState,
  Usage,
  WearWithRequest,
  Wish,
} from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { createLimits, ESTIMATED_COST_MICROS, periodStart } from "../src/modules/usage/limits";
import { checkBrief, refreshBrief, type OutfitJobDeps } from "../src/modules/outfits/outfit-jobs";
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
  STUB_TOKENS,
  unitVector,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup({
  stylistEnabled = true,
  embedder = null,
}: { stylistEnabled?: boolean; embedder?: ItemEmbedder | null } = {}) {
  // Moved on by tests: the jobs, the routes and new rows all read it.
  const clock = { now: new Date("2026-10-21T12:00:00Z") };
  const repositories = createInMemoryRepositories(() => clock.now);
  const storage = createMemoryStorage();
  const queue = createManualOutfitQueue();
  const photoQueue = createManualPhotoQueue();
  const stub = createStubStylist();
  const cut = createStubRemover();
  const logged: Record<string, unknown>[] = [];
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
    clock: () => clock.now,
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
    limits: createLimits(repositories.usageRepository, { dailyUsd: 3, userMonthlyUsd: 5 }),
    clock: () => clock.now,
    log: (line) => logged.push(line),
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
    clock,
    deps,
    photoDeps,
    logged,
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
  // The English type the tagger gives: it tells a bag from other accessories.
  noun = "linen shirt",
) {
  const key = `photos/${userId}/p${++made}.webp`;
  await storage.put(key, await picture, "image/webp");
  await repositories.photosRepository.createReady({
    key,
    ownerId: userId,
    tags: { ...shirtTags, category, noun },
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

    const save = vi.spyOn(s.repositories.outfitsRepository, "saveOutfits");
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    expect(done.status).toBe("done");
    // What the call cost is stored with the tokens behind it.
    expect(save.mock.calls[0]![3]).toEqual({ micros: 6_000, tokens: STUB_TOKENS });
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
    expect(call!).toMatchObject({ lang: "ru", season: "autumn", looks: 3, brief: null });
    // No embedding for the item, so nothing to pick partner pieces by.
    expect(call!.shop).toBeNull();
  });

  it("finishes every look with shoes and a bag: hers first, a partner's where she has none", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    await addItem(s, anna, "top");
    const bag = await addItem(s, anna, "accessory", "shoulder bag");
    // A hat is an accessory too, not a bag.
    await addItem(s, anna, "accessory", "felt fedora hat");
    const boots = await s.repositories.catalogRepository.add({ category: "shoes" });
    // A dress would replace the look rather than finish it: never offered.
    await s.repositories.catalogRepository.add({ category: "dress" });

    const { id } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();
    await s.runJobs();

    const [call] = s.stub.composeCalls;
    expect(call!.shop!.pieces).toEqual([
      expect.objectContaining({ n: 6, name: "Ankle boots", category: "shoes" }),
    ]);
    const done = (
      await s.server.inject({
        method: "GET",
        url: `/api/wear-with/${id}?lang=ru`,
        headers: { cookie: anna.cookie },
      })
    ).json<WearWithRequest>();
    // She owns no shoes: the partner's boots finish every look, the one the model forgot too;
    // her bag goes in every look the model left without one.
    for (const outfit of done.outfits) {
      expect(outfit.pieces.find((p) => p.catalogItem)?.catalogItem?.name).toBe("Ботинки");
      expect(outfit.pieces.map((p) => p.item?.id)).toContain(bag.id);
    }
    // The boots fill the shoes the first look said it lacked.
    expect(done.outfits[0]!.missing).toBeNull();
    expect(s.repositories.catalogRepository.events).toHaveLength(done.outfits.length);
    expect(s.repositories.catalogRepository.events[0]).toEqual({
      catalogItemId: boots.id,
      userId: anna.userId,
      event: "shown",
    });
  });

  it("shows a brand's other piece in two looks at most, and never shoes next to hers", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    await addItem(s, anna, "top");
    const sneakers = await addItem(s, anna, "shoes", "white sneakers");
    await addItem(s, anna, "accessory", "straw tote");
    const jacket = await s.repositories.catalogRepository.add({
      category: "outerwear",
      names: { en: "Denim jacket", ru: "Джинсовая куртка" },
    });
    await s.repositories.catalogRepository.add({ category: "shoes" });
    s.stub.stylist.compose = async (input) => {
      const pieces = input.wardrobe.map((p) => p.n);
      const [boots, denim] = ["shoes", "outerwear"].map(
        (category) => input.shop!.pieces.find((p) => p.category === category)!.n,
      );
      return {
        looks: [1, 2, 3, 4].map((i) => ({
          items: pieces,
          // Partner boots next to her sneakers in the last look, the jacket in the first three.
          partners: i < 4 ? [denim!] : [boots!],
          missing: null,
          caption: `Look ${i}`,
          occasion: "coffee",
          why: "because",
        })),
        verdict: null,
        costMicros: 6_000,
      };
    };

    const { id } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    // The third look loses its jacket to the cap and the fourth the boots: both hidden.
    expect(done.outfits.map((o) => o.pieces.flatMap((p) => p.catalogItem?.id ?? []))).toEqual([
      [jacket.id],
      [jacket.id],
    ]);
    for (const outfit of done.outfits) {
      expect(outfit.pieces.map((p) => p.item?.id)).toContain(sneakers.id);
    }
  });

  it("promotes a partner bag in two looks at most when she has bags of her own", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    await addItem(s, anna, "top");
    await addItem(s, anna, "shoes", "white sneakers");
    const tote = await addItem(s, anna, "accessory", "straw tote");
    const partnerBag = await s.repositories.catalogRepository.add({
      category: "accessory",
      names: { en: "Shoulder bag", ru: "Сумка на плечо" },
    });
    s.stub.stylist.compose = async (input) => ({
      looks: [1, 2, 3, 4].map((i) => ({
        // Her top and shoes, and the partner's bag in three looks; her tote in the last.
        items: input.wardrobe.filter((p) => i === 4 || p.category !== "accessory").map((p) => p.n),
        partners: i < 4 ? [input.shop!.pieces.find((p) => p.category === "accessory")!.n] : [],
        missing: null,
        caption: `Look ${i}`,
        occasion: "coffee",
        why: "because",
      })),
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    const bags = done.outfits.map(
      (o) =>
        o.pieces.find((p) => p.catalogItem)?.catalogItem?.id ??
        o.pieces.find((p) => p.item?.id === tote.id)?.item?.id,
    );
    // The third look's "why" speaks of the partner's bag past the cap: it isn't shown with her
    // tote instead.
    expect(done.outfits.map((o) => o.caption)).toEqual(["Look 1", "Look 2", "Look 4"]);
    expect(bags).toEqual([partnerBag.id, partnerBag.id, tote.id]);
    // One bag a look: hers isn't added next to the partner's.
    expect(done.outfits.map((o) => o.pieces.some((p) => p.item?.id === tote.id))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("doesn't show a look that lost a piece its why may name", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const sneakers = await addItem(s, anna, "shoes", "white sneakers");
    const boots = await addItem(s, anna, "shoes", "pink boots");
    await addItem(s, anna, "top");
    await addItem(s, anna, "bottom");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          // Her pink boots next to the sneakers being styled: the boots go.
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Two pairs",
          occasion: "coffee",
          why: "the pink boots make it",
        },
        {
          items: input.wardrobe.filter((p) => p.category !== "shoes").map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Sneakers",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, sneakers.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    expect(done.outfits.map((o) => o.caption)).toEqual(["Sneakers"]);
    expect(done.outfits[0]!.pieces.map((p) => p.item?.id)).not.toContain(boots.id);
  });

  it("gives a brand's places to the looks it shows, and shows every look when all lost a piece", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const plaid = await addItem(s, anna, "top", "plaid shirt");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    await addItem(s, anna, "top", "striped shirt");
    await addItem(s, anna, "bottom");
    await s.repositories.catalogRepository.add({ category: "outerwear" });
    let shirts = [1];
    s.stub.stylist.compose = async (input) => ({
      looks: [1, 2, 3].map((i) => ({
        // A brand's jacket in every look, and a second shirt in the ones in `shirts`.
        items: input.wardrobe
          .filter((p) => shirts.includes(i) || p.category !== "top")
          .map((p) => p.n),
        partners: [input.shop!.pieces[0]!.n],
        missing: null,
        caption: `Look ${i}`,
        occasion: "coffee",
        why: "because",
      })),
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, plaid.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    expect(done.outfits.map((o) => [o.caption, o.pieces.some((p) => p.catalogItem)])).toEqual([
      ["Look 2", true],
      ["Look 3", true],
    ]);
    expect(s.logged).toEqual([
      { msg: "looks hidden", requestId: id, asked: 3, shown: 2, incomplete: 0, lost: 1 },
    ]);

    // Every look lost its second shirt: all are shown, the jacket in two.
    shirts = [1, 2, 3];
    await addItem(s, anna, "bottom");
    const again = (await ask(s, anna.cookie, plaid.id)).json<{ id: string }>();
    await s.runJobs();
    const all = await view(s, anna.cookie, again.id);
    expect(all.outfits.map((o) => [o.caption, o.pieces.some((p) => p.catalogItem)])).toEqual([
      ["Look 1", true],
      ["Look 2", true],
      ["Look 3", false],
    ]);
  });

  it("never puts a top over a dress", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const dress = await addItem(s, anna, "dress");
    const top = await addItem(s, anna, "top");
    const jacket = await addItem(s, anna, "outerwear");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Layers",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, dress.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    const ids = done.outfits[0]!.pieces.map((p) => p.item?.id);
    expect(ids).toContain(jacket.id);
    expect(ids).not.toContain(top.id);
  });

  it("never puts a second pair next to shoes being styled", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const boots = await addItem(s, anna, "shoes", "ankle boots");
    const sneakers = await addItem(s, anna, "shoes", "white sneakers");
    await addItem(s, anna, "top");
    await addItem(s, anna, "bottom");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Two pairs",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, boots.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    expect(done.outfits[0]!.pieces.map((p) => p.item?.id)).not.toContain(sneakers.id);
  });

  it("keeps one shirt in a look", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const plaid = await addItem(s, anna, "top", "plaid shirt");
    const striped = await addItem(s, anna, "top", "striped shirt");
    // A tube top under the open shirt is a look she likes.
    const tube = await addItem(s, anna, "top", "tube top");
    await addItem(s, anna, "bottom");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Two shirts",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, plaid.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    const ids = done.outfits[0]!.pieces.map((p) => p.item?.id);
    expect(ids).toContain(tube.id);
    expect(ids).not.toContain(striped.id);
  });

  it("keeps one bottom in a look: no skirt over the jeans being styled", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const jeans = await addItem(s, anna, "bottom", "wide-leg jeans");
    const skirt = await addItem(s, anna, "bottom", "printed skirt");
    const tank = await addItem(s, anna, "top", "tank top");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Skirt over jeans",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, jeans.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    const ids = done.outfits[0]!.pieces.map((p) => p.item?.id);
    expect(ids).toContain(jeans.id);
    expect(ids).toContain(tank.id);
    expect(ids).not.toContain(skirt.id);
  });

  it("keeps a dress look free of bottoms, whether the dress is styled or chosen", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const dress = await addItem(s, anna, "dress");
    const skirt = await addItem(s, anna, "bottom");
    const boots = await addItem(s, anna, "shoes", "ankle boots");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Skirt with a dress",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    for (const hero of [dress, boots]) {
      const { id } = (await ask(s, anna.cookie, hero.id)).json<{ id: string }>();
      await s.runJobs();
      const ids = (await view(s, anna.cookie, id)).outfits[0]!.pieces.map((p) => p.item?.id);
      expect(ids).toEqual(expect.arrayContaining([dress.id, boots.id]));
      expect(ids).not.toContain(skirt.id);
    }
  });

  it("keeps a brand's bottom out of a look that has one", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    // A brand's bottom reaches the shop sheet only around a piece that isn't one.
    const tank = await addItem(s, anna, "top", "tank top");
    await s.repositories.photosRepository.setEmbedding(
      `photos/${anna.userId}/p${made}.webp`,
      unitVector(1),
    );
    const jeans = await addItem(s, anna, "bottom", "wide-leg jeans");
    await s.repositories.catalogRepository.add({ category: "bottom" });
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [input.shop!.pieces[0]!.n],
          missing: null,
          caption: "A brand's skirt over jeans",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, tank.id)).json<{ id: string }>();
    await s.runJobs();
    const pieces = (await view(s, anna.cookie, id)).outfits[0]!.pieces;
    expect(pieces.map((p) => p.item?.id)).toContain(jeans.id);
    expect(pieces.some((p) => p.catalogItem)).toBe(false);
  });

  it("never puts a dress with a top or a skirt being styled", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const top = await addItem(s, anna, "top", "tank top");
    const dress = await addItem(s, anna, "dress");
    const skirt = await addItem(s, anna, "bottom");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: null,
          caption: "Top over a dress",
          occasion: "coffee",
          why: "because",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, top.id)).json<{ id: string }>();
    await s.runJobs();
    const done = await view(s, anna.cookie, id);
    const ids = done.outfits[0]!.pieces.map((p) => p.item?.id);
    expect(ids).toContain(skirt.id);
    expect(ids).not.toContain(dress.id);
  });

  it("keeps piece numbers out of every text she reads", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    const skirt = await addItem(s, anna, "bottom");
    await addItem(s, anna, "top", "tank top");
    s.stub.stylist.compose = async (input) => ({
      looks: [
        {
          items: input.wardrobe.map((p) => p.n),
          partners: [],
          missing: { category: "outerwear", description: "a jacket like #5" },
          caption: "Tank #2 and skirt",
          occasion: "brunch with #3",
          why: "Your tank #2 softens the skirt.",
        },
      ],
      verdict: null,
      costMicros: 6_000,
    });

    const { id } = (await ask(s, anna.cookie, skirt.id)).json<{ id: string }>();
    await s.runJobs();
    const [look] = (await view(s, anna.cookie, id)).outfits;
    expect([look!.caption, look!.occasion, look!.why, look!.missing?.description]).toEqual([
      "Tank and skirt",
      "brunch with",
      "Your tank softens the skirt.",
      "a jacket like",
    ]);
  });

  it("keeps a wardrobe piece the model took off the sheet, and drops a look without a bottom", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    // Tanks, not shirts: a look keeps one shirt.
    const top = await addItem(s, anna, "top", "tank top");
    // More tops than the sheet has room for next to a top: some stay off it.
    const tops = [];
    for (let i = 0; i < 6; i++) tops.push(await addItem(s, anna, "top", "tank top"));
    const offSheet = tops.at(-1)!;
    const skirt = await addItem(s, anna, "bottom");
    s.stub.stylist.compose = async (input) => {
      const skirtN = input.wardrobe.find((p) => p.name === skirt.name)!.n;
      const lastTop = input.wardrobe.find((p) => p.name === offSheet.name)!.n;
      const look = (items: number[], caption: string) => ({
        items,
        partners: [],
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
    await s.repositories.outfitsRepository.saveBrief(
      anna.userId,
      { brief: "New taste", summary: { en: "New", ru: "Новое", he: "חדש" } },
      { itemCount: 2, reactionCount: 0, inspirationCount: 3 },
      new Date(),
    );
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

// Eight items and a first brief, as in the style brief test.
async function withBrief(s: Setup) {
  const anna = await signUp(s, "anna@example.com");
  const pieces = [];
  for (let i = 0; i < 8; i++) pieces.push(await addItem(s, anna, i % 2 ? "bottom" : "top"));
  await ask(s, anna.cookie, pieces[0]!.id);
  await s.runJobs();
  expect(s.stub.briefCalls).toHaveLength(1);
  return { anna, pieces };
}

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

  it("isn't rewritten on its own as the wardrobe grows, only a month on", async () => {
    const s = await setup();
    const { anna, pieces } = await withBrief(s);

    for (let i = 0; i < 5; i++) await addItem(s, anna, "top");
    s.clock.now = new Date("2026-10-25T12:00:00Z");
    await ask(s, anna.cookie, pieces[1]!.id);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(1);

    // A month later, with the wardrobe changed: rewritten, from the brief it replaces.
    s.clock.now = new Date("2026-11-21T12:30:00Z");
    await ask(s, anna.cookie, pieces[2]!.id);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(2);
    expect(s.stub.briefCalls[1]!.previous).toBe("High-low with a wink.");
  });

  it("waits a day after a batch that failed instead of sending another", async () => {
    const s = await setup();
    s.stub.briefBatch.status = "failed";
    const { anna, pieces } = await withBrief(s);
    expect((await s.repositories.outfitsRepository.brief(anna.userId))?.brief).toBeNull();

    // Still no brief, so it's stale, yet the next request sends no batch.
    s.clock.now = new Date("2026-10-21T18:00:00Z");
    await ask(s, anna.cookie, pieces[1]!.id);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(1);

    s.stub.briefBatch.status = "done";
    s.clock.now = new Date("2026-10-22T12:30:00Z");
    await ask(s, anna.cookie, pieces[2]!.id);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(2);
    expect((await s.repositories.outfitsRepository.brief(anna.userId))?.brief).toBe(
      "High-low with a wink.",
    );
  });

  it("records what the brief cost, and sends none past her monthly cap", async () => {
    const s = await setup();
    const { anna } = await withBrief(s);
    const usage = s.repositories.usageRepository;
    const monthStart = periodStart("month", s.clock.now);
    // The stub's brief: 5 ¢, on top of the request's estimate.
    expect(await usage.spentBy(anna.userId, monthStart)).toBe(
      ESTIMATED_COST_MICROS.wear_with + 50_000,
    );

    const maya = await signUp(s, "maya@example.com");
    await usage.record(maya.userId, "brief", 4_950_000);
    const pieces = [];
    for (let i = 0; i < 8; i++) pieces.push(await addItem(s, maya, i % 2 ? "bottom" : "top"));
    await ask(s, maya.cookie, pieces[0]!.id);
    await s.runJobs();
    // Still only Anna's brief.
    expect(s.stub.briefCalls).toHaveLength(1);
  });

  it("gives up on a batch still running after a day, and sends a new one", async () => {
    const s = await setup();
    // The brief check is run straight away by the test queue: it finds the batch running.
    const anna = await signUp(s, "anna@example.com");
    for (let i = 0; i < 8; i++) await addItem(s, anna, i % 2 ? "bottom" : "top");
    // Jobs run one by one here: the test queue would run a "still running" check forever.
    s.stub.briefBatch.status = "pending";
    await refreshBrief(s.deps, anna.userId);
    await checkBrief(s.deps, anna.userId);
    expect((await s.repositories.outfitsRepository.brief(anna.userId))?.batchId).toBe("batch-1");

    s.clock.now = new Date("2026-10-22T12:01:00Z");
    await checkBrief(s.deps, anna.userId);
    expect((await s.repositories.outfitsRepository.brief(anna.userId))?.batchId).toBeNull();
    await refreshBrief(s.deps, anna.userId);
    expect(s.stub.briefCalls).toHaveLength(2);
  });
});

describe("her style", () => {
  const style = async ({ server }: Setup, cookie: string, lang = "en") =>
    server.inject({ method: "GET", url: `/api/style?lang=${lang}`, headers: { cookie } });
  const refresh = ({ server }: Setup, cookie: string) =>
    server.inject({ method: "POST", url: "/api/style/refresh", headers: { cookie } });

  it("shows the summary in her language, and offers an update after a day of shopping", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    expect((await style(s, anna.cookie)).json<StyleState>()).toEqual({
      summary: null,
      writtenAt: null,
      updating: false,
      suggest: null,
    });
    // No brief yet: the first one comes on its own.
    expect((await refresh(s, anna.cookie)).json<{ message: string }>().message).toBe("style:none");

    const pieces = [];
    for (let i = 0; i < 8; i++) pieces.push(await addItem(s, anna, i % 2 ? "bottom" : "top"));
    await ask(s, anna.cookie, pieces[0]!.id);
    await s.runJobs();
    expect((await style(s, anna.cookie, "ru")).json<StyleState>()).toMatchObject({
      summary: "Дорогое с простым и с изюминкой.",
      updating: false,
      suggest: null,
    });

    // The next day, four new pieces aren't a shopping day yet; five are.
    s.clock.now = new Date("2026-10-22T13:00:00Z");
    for (let i = 0; i < 4; i++) await addItem(s, anna, "shoes");
    expect((await style(s, anna.cookie)).json<StyleState>().suggest).toBeNull();
    await addItem(s, anna, "accessory", "shoulder bag");
    expect((await style(s, anna.cookie)).json<StyleState>().suggest).toEqual({
      items: 5,
      looks: 0,
    });

    // She taps "update": no more offers while it's written, then the new brief.
    const asked = await refresh(s, anna.cookie);
    expect(asked.statusCode).toBe(202);
    expect(asked.json<StyleState>()).toMatchObject({ updating: true, suggest: null });
    expect((await refresh(s, anna.cookie)).json<{ message: string }>().message).toBe(
      "style:updating",
    );
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(2);
    expect(s.stub.briefCalls[1]!.wardrobe).toHaveLength(13);
    expect((await style(s, anna.cookie)).json<StyleState>()).toMatchObject({
      updating: false,
      suggest: null,
    });
    // Once a day at most.
    expect((await refresh(s, anna.cookie)).json<{ message: string }>().message).toBe("style:wait");
  });

  it("drops a request the job can't answer, instead of writing it on a later trigger", async () => {
    const s = await setup();
    const { anna, pieces } = await withBrief(s);
    s.clock.now = new Date("2026-10-22T13:00:00Z");
    expect((await refresh(s, anna.cookie)).statusCode).toBe(202);
    // Too few pieces by the time the job gets to it.
    await s.server.inject({
      method: "DELETE",
      url: `/api/items/${pieces[7]!.id}`,
      headers: { cookie: anna.cookie },
    });
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(1);
    expect((await s.repositories.outfitsRepository.brief(anna.userId))?.askedAt).toBeNull();

    // Enough again, and a later trigger (a like, a saved look) writes nothing she didn't ask for.
    await addItem(s, anna, "top");
    await s.queue.outfitQueue.enqueueBrief(anna.userId);
    await s.runJobs();
    expect(s.stub.briefCalls).toHaveLength(1);
  });

  it("counts what a brief in the wrong shape cost", async () => {
    const s = await setup();
    s.stub.briefBatch.status = "malformed";
    const { anna } = await withBrief(s);
    expect((await s.repositories.outfitsRepository.brief(anna.userId))?.brief).toBeNull();
    expect(
      await s.repositories.usageRepository.spentBy(anna.userId, periodStart("month", s.clock.now)),
    ).toBe(ESTIMATED_COST_MICROS.wear_with + 40_000);
  });

  it("offers no update past her monthly cap", async () => {
    const s = await setup();
    const { anna } = await withBrief(s);
    s.clock.now = new Date("2026-10-22T13:00:00Z");
    for (let i = 0; i < 5; i++) await addItem(s, anna, "top");
    expect((await style(s, anna.cookie)).json<StyleState>().suggest).not.toBeNull();
    await s.repositories.usageRepository.record(anna.userId, "brief", 4_950_000);
    expect((await style(s, anna.cookie)).json<StyleState>().suggest).toBeNull();
  });

  it("isn't updated past her monthly AI cap", async () => {
    const s = await setup();
    const { anna } = await withBrief(s);
    await s.repositories.usageRepository.record(anna.userId, "brief", 4_950_000);
    s.clock.now = new Date("2026-10-22T13:00:00Z");
    const res = await refresh(s, anna.cookie);
    expect(res.statusCode).toBe(429);
    expect(res.json<{ message: string }>().message).toBe("limit:monthly");
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
    expect(
      (
        await s.server.inject({
          method: "GET",
          url: "/api/wishes/due",
          headers: { cookie: anna.cookie },
        })
      ).json(),
    ).toEqual({ count: 1 });
    expect((await answer("still")).statusCode).toBe(204);
    expect((await wishes(anna.cookie)).json<Wish[]>()[0]!.due).toBe(false);
    expect(row.stillCount).toBe(1);
    // A retried "still" before the next week doesn't count again.
    expect((await answer("still")).statusCode).toBe(409);
    expect(row.stillCount).toBe(1);
    expect((await answer("no")).statusCode).toBe(204);
    expect((await wishes(anna.cookie)).json<Wish[]>()).toEqual([]);
    expect((await answer("no")).statusCode).toBe(404);
  });

  it("lets a wish go once its piece is added to the closet, and won't save one that's there", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    await addItem(s, anna, "top");
    const requestId = await styleFromPhoto(s, anna.cookie);
    await s.server.inject({
      method: "POST",
      url: "/api/wishes",
      headers: { cookie: anna.cookie },
      payload: { requestId },
    });

    // Bought it, and added it from its outfits.
    const { addable } = await view(s, anna.cookie, requestId);
    await s.server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie: anna.cookie },
      payload: addable!,
    });
    const list = await s.server.inject({
      method: "GET",
      url: "/api/wishes",
      headers: { cookie: anna.cookie },
    });
    expect(list.json()).toEqual([]);
    const again = await s.server.inject({
      method: "POST",
      url: "/api/wishes",
      headers: { cookie: anna.cookie },
      payload: { requestId },
    });
    expect(again.statusCode).toBe(409);
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

  it("keeps the crop when the cut-out comes out in pieces", async () => {
    const s = await setup();
    const anna = await signUp(s, "anna@example.com");
    await addItem(s, anna, "top");
    // Two halves, as when an arm crosses a worn garment.
    const halves = () =>
      sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([
          {
            input: { create: { width: 80, height: 160, channels: 4, background: "#555" } },
            left: 10,
            top: 20,
          },
          {
            input: { create: { width: 80, height: 160, channels: 4, background: "#555" } },
            left: 110,
            top: 20,
          },
        ])
        .png()
        .toBuffer();
    s.cut.remover.removeBackground = halves;
    const id = await styleFromPhoto(s, anna.cookie);

    const [hero] = (await view(s, anna.cookie, id)).outfits[0]!.pieces;
    expect(hero!.item).toMatchObject({ photoUrl: `/api/wear-with/${id}/photo` });
    expect(hero!.item!.cutoutUrl).toBeUndefined();
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
