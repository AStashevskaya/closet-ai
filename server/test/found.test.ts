import type { FoundPiece } from "@closet-ai/shared";
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

afterEach(async () => {
  await app?.close();
});

// Looks are marked worn on the real clock (the in-memory double's), so the test's "today" is set
// 40 days after it, and pieces were added the day before it.
const DAY = 86_400_000;
const TODAY = new Date(Date.now() + 40 * DAY);
const MONTH_AGO = new Date(Date.now() - DAY);

async function setup() {
  const clock = { now: TODAY };
  const repositories = createInMemoryRepositories(() => clock.now);
  app = await buildApp({
    env,
    auth: createAuth(env, memoryAdapter({ user: [], session: [], account: [], verification: [] })),
    ...repositories,
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    storage: createMemoryStorage(),
    taggingEnabled: true,
    stylistEnabled: true,
    clock: () => clock.now,
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: {
      privacyConsent: "2026-11-05",
      name: "Anna",
      email: "anna@example.com",
      password: "correct-horse-battery",
    },
  });
  const cookie = res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const session = await app.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie },
  });
  const userId = session.json<{ user: { id: string } }>().user.id;
  // A piece in her closet with a ready photo, added a month ago.
  const addItem = async (category: string, noun: string) => {
    clock.now = MONTH_AGO;
    const key = `photos/${userId}/${noun.replace(/\W/g, "")}.webp`;
    await repositories.photosRepository.createReady({
      key,
      ownerId: userId,
      tags: {
        recognized: true,
        name: noun,
        category,
        colors: ["black"],
        seasons: [],
        fit: null,
        length: null,
        fabric: null,
        style: null,
        brand: null,
        condition: null,
        noun,
      } as never,
    });
    const created = await app!.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { name: noun, category, colors: ["black"], photoKey: key },
    });
    clock.now = TODAY;
    return created.json<{ id: string }>().id;
  };
  // She wore a look of these pieces (on the real clock: 40 days before the test's today).
  const wear = async (itemIds: string[]) => {
    const outfits = repositories.outfitsRepository;
    const requestId = await outfits.createRequest(userId, { itemId: itemIds[0]! }, 1, null);
    await outfits.saveOutfits(
      requestId,
      userId,
      [
        {
          caption: "Worn",
          occasion: "day",
          why: "why",
          missing: null,
          pieces: itemIds.map((itemId, i) => ({ hero: i === 0, itemId })),
        },
      ],
      { micros: 0 },
    );
    const look = (await outfits.view(requestId, userId, "en"))!.outfits[0]!;
    await outfits.react(look.id, userId, "wore");
  };
  const read = async () =>
    (
      await app!.inject({ method: "GET", url: "/api/found?lang=en", headers: { cookie } })
    ).json<FoundPiece>();
  return { addItem, wear, read, cookie };
}

describe("GET /api/found", () => {
  it("brings back a piece she hasn't touched, with three looks she hasn't worn", async () => {
    const { addItem, read } = await setup();
    const cardigan = await addItem("top", "cardigan");
    for (const noun of ["jeans", "skirt", "trousers"]) await addItem("bottom", noun);
    await addItem("shoes", "loafers");

    const found = await read();
    expect(found.piece?.id).toBe(cardigan);
    expect(found.looks).toHaveLength(3);
    for (const look of found.looks) {
      expect(look.pieces.map((p) => p.id)).toContain(cardigan);
      expect(look.pieces.map((p) => p.category)).toContain("shoes");
    }
  });

  it("brings back nothing without shoes to wear it with", async () => {
    const { addItem, read } = await setup();
    await addItem("top", "cardigan");
    await addItem("bottom", "jeans");
    expect(await read()).toEqual({ piece: null, looks: [] });
  });

  it("passes to the next find when the first has nothing new to go with", async () => {
    const { addItem, wear, read } = await setup();
    // Worn with the only bottom 40 days ago: a find, but no new look.
    const worn = await addItem("top", "striped tee");
    const fresh = await addItem("top", "silk blouse");
    const jeans = await addItem("bottom", "jeans");
    const loafers = await addItem("shoes", "loafers");
    await wear([worn, jeans, loafers]);

    const found = await read();
    expect(found.piece?.id).toBe(fresh);
    expect(found.looks.map((look) => look.pieces.map((p) => p.id).sort())).toEqual([
      [fresh, jeans, loafers].sort(),
    ]);
  });

  it("asks her to sign in", async () => {
    await setup();
    expect((await app!.inject({ method: "GET", url: "/api/found" })).statusCode).toBe(401);
  });
});
