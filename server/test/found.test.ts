import type { FoundPiece } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { pickFound } from "../src/modules/found/found-piece";
import { createMemoryStorage } from "../src/storage/storage";
import { mondayOf, type WeatherClient } from "../src/weather/weather";
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

async function setup(weather: WeatherClient | null = null) {
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
    weather,
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
  const setCity = (city: string) =>
    app!.inject({ method: "PATCH", url: "/api/profile", headers: { cookie }, payload: { city } });
  const wearFound = (pieces: string[]) =>
    app!.inject({
      method: "POST",
      url: "/api/found/wear?lang=en",
      headers: { cookie },
      payload: { pieces },
    });
  const tomorrowsLook = async () => {
    clock.now = new Date(TODAY.getTime() + DAY);
    const today = (
      await app!.inject({ method: "GET", url: "/api/today?lang=en", headers: { cookie } })
    ).json<{ look: { pieces: { item: { id: string } | null }[] } | null }>();
    clock.now = TODAY;
    return today.look?.pieces.flatMap((p) => (p.item ? [p.item.id] : [])).sort() ?? null;
  };
  return { addItem, wear, read, setCity, userId, wearFound, tomorrowsLook };
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
    expect(await read()).toMatchObject({ piece: null, looks: [] });
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

  it("draws the week's find by her city's week, not the server's", async () => {
    // Her city is past midnight into a Monday while UTC is still on Sunday: find a Sunday where
    // the two weeks draw differently, so the test tells them apart.
    const sunday = (n: number) => {
      const day = new Date(TODAY.getTime() + n * DAY);
      return day.getUTCDay() === 0 ? day.toISOString().slice(0, 10) : null;
    };
    const city = { today: "" };
    const { addItem, read, setCity, userId } = await setup({
      week: async () => ({
        place: "Минск",
        today: city.today,
        offsetSeconds: 3 * 3600,
        days: [],
      }),
    });
    await setCity("Minsk");
    const tops = [];
    for (const noun of ["tee", "blouse", "shirt", "polo", "tank"])
      tops.push({
        id: await addItem("top", noun),
        category: "top",
        seasons: [],
        createdAt: MONTH_AGO,
      });
    await addItem("bottom", "jeans");
    await addItem("shoes", "loafers");
    const options = (week: string) => ({ season: "winter" as const, now: TODAY, userId, week });

    for (let n = 0; n < 60; n++) {
      const utcSunday = sunday(n);
      if (!utcSunday) continue;
      const cityMonday = new Date(Date.parse(utcSunday) + DAY).toISOString().slice(0, 10);
      const byCity = pickFound(tops, [], options(mondayOf(cityMonday)))[0];
      const byUtc = pickFound(tops, [], options(mondayOf(utcSunday)))[0];
      if (byCity === byUtc) continue;
      city.today = cityMonday;
      expect((await read()).piece?.id).toBe(byCity);
      return;
    }
    throw new Error("no Sunday drew differently in 60 days");
  });

  it("asks her to sign in", async () => {
    await setup();
    expect((await app!.inject({ method: "GET", url: "/api/found" })).statusCode).toBe(401);
  });
});

describe("POST /api/found/wear", () => {
  it("makes the look tomorrow's look of the day, once, and refuses another for that day", async () => {
    const { addItem, read, wearFound, tomorrowsLook } = await setup();
    await addItem("top", "cardigan");
    for (const noun of ["jeans", "skirt", "trousers"]) await addItem("bottom", noun);
    await addItem("shoes", "loafers");
    const [first, second] = (await read()).looks.map((look) => look.pieces.map((p) => p.id));

    const tomorrow = new Date(TODAY.getTime() + DAY).toISOString().slice(0, 10);
    const res = await wearFound(first!);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ date: tomorrow });
    // The same tap again answers the same; another look for that day is refused.
    expect((await wearFound([...first!].reverse())).statusCode).toBe(200);
    expect((await wearFound(second!)).statusCode).toBe(409);

    expect(await tomorrowsLook()).toEqual([...first!].sort());
  });

  it("takes only a look this week's find offers", async () => {
    const { addItem, read, wearFound } = await setup();
    const cardigan = await addItem("top", "cardigan");
    const jeans = await addItem("bottom", "jeans");
    await addItem("bottom", "skirt");
    await addItem("shoes", "loafers");
    expect((await read()).piece?.id).toBe(cardigan);
    // Hers, but not one of the looks offered: no shoes.
    expect((await wearFound([cardigan, jeans])).statusCode).toBe(400);
  });

  it("two looks for tomorrow at once: one is taken, the other refused", async () => {
    const { addItem, read, wearFound, tomorrowsLook } = await setup();
    await addItem("top", "cardigan");
    for (const noun of ["jeans", "skirt"]) await addItem("bottom", noun);
    await addItem("shoes", "loafers");
    const [first, second] = (await read()).looks.map((look) => look.pieces.map((p) => p.id));

    const answers = await Promise.all([wearFound(first!), wearFound(second!)]);
    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    const taken = answers[0].statusCode === 200 ? first! : second!;
    expect(await tomorrowsLook()).toEqual([...taken].sort());
  });

  it("takes only her own pieces", async () => {
    const { addItem, wearFound } = await setup();
    await addItem("top", "cardigan");
    const res = await wearFound(["11111111-1111-4111-8111-111111111111"]);
    expect(res.statusCode).toBe(404);
  });
});
