import type { Usage } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { createLimits, nextPeriodStart, periodStart } from "../src/modules/usage/limits";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  testEnv,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

async function setup(budgetUsd = testEnv.AI_DAILY_BUDGET_USD) {
  const auth = createAuth(
    testEnv,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({
    env: { ...testEnv, AI_DAILY_BUDGET_USD: budgetUsd },
    auth,
    ...createInMemoryRepositories(),
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    stylistEnabled: false,
    storage: createMemoryStorage(),
    taggingEnabled: true,
  });
  return app;
}

afterEach(async () => {
  await app?.close();
});

async function signUp(server: App, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: "correct-horse-battery" },
  });
  return res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

const photo = sharp({
  create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 200, b: 200 } },
})
  .jpeg()
  .toBuffer();

async function upload(server: App, cookie: string, kind: "item" | "want" | "look") {
  const form = new FormData();
  form.append("photo", new Blob([await photo], { type: "image/jpeg" }), "photo.jpg");
  return server.inject({
    method: "POST",
    url: `/api/photos?kind=${kind}`,
    headers: { cookie },
    payload: form,
  });
}

const addItem = (server: App, cookie: string) =>
  server.inject({
    method: "POST",
    url: "/api/items",
    headers: { cookie },
    payload: { name: "Shirt", category: "top", colors: ["white"] },
  });

const usageOf = async (server: App, cookie: string) =>
  (await server.inject({ method: "GET", url: "/api/usage", headers: { cookie } })).json<Usage>();

describe("free-tier limits", () => {
  it("has no limit on the wardrobe itself", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    for (let i = 0; i < 40; i++) expect((await addItem(server, cookie)).statusCode).toBe(201);
    expect((await upload(server, cookie, "item")).statusCode).toBe(201);
  });

  it("counts want screenshots per month, per user", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    for (let i = 0; i < 5; i++) expect((await upload(server, anna, "want")).statusCode).toBe(201);

    const sixth = await upload(server, anna, "want");
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json<{ message: string }>().message).toBe("limit:want");
    expect((await upload(server, maya, "want")).statusCode).toBe(201);

    const { want, look } = await usageOf(server, anna);
    expect(want).toMatchObject({ used: 5, limit: 5 });
    expect(new Date(want.resetsAt).getUTCDate()).toBe(1);
    expect(look).toMatchObject({ used: 0, limit: 3 });
  });

  it("stops every counted action once the server's daily budget is spent", async () => {
    // Room for one item photo (0.6 ¢) and not a second.
    const server = await setup(0.01);
    const cookie = await signUp(server, "anna@example.com");
    expect((await upload(server, cookie, "item")).statusCode).toBe(201);
    const second = await upload(server, cookie, "item");
    expect(second.statusCode).toBe(429);
    expect(second.json<{ message: string }>().message).toBe("limit:budget");
  });
});

describe("half of the daily budget", () => {
  // The in-memory rows are stamped with the real time, so the clock is moved from it.
  const realNow = () => new Date();
  const logged: Record<string, unknown>[] = [];
  const setup = (clock: () => Date, spentSince?: () => Promise<number>) => {
    logged.length = 0;
    const { usageRepository } = createInMemoryRepositories();
    if (spentSince) usageRepository.spentSince = spentSince;
    const budgets = {
      dailyUsd: 0.02,
      userMonthlyUsd: 5,
      log: (line: Record<string, unknown>) => void logged.push(line),
    };
    return createLimits(usageRepository, budgets, new Set(), clock);
  };

  it("is logged once a day, when spend crosses it", async () => {
    const limits = setup(realNow);
    await limits.record("anna", "item_photo"); // 0.6 ¢ of 2 ¢
    expect(logged).toEqual([]);
    await limits.record("anna", "item_photo"); // 1.2 ¢: past half
    await limits.spent("anna", "brief", 1_000);
    expect(logged).toEqual([{ msg: "ai budget half spent", spentUsd: 0.012, budgetUsd: 0.02 }]);
  });

  it("is logged again on the next day", async () => {
    let now = new Date("2026-10-28T23:00:00Z");
    // Every day is past half here, whatever the rows' real time.
    const limits = setup(
      () => now,
      async () => 15_000,
    );
    await limits.record("anna", "item_photo");
    await limits.record("anna", "item_photo");
    now = new Date("2026-10-29T00:30:00Z");
    await limits.record("anna", "item_photo");
    expect(logged).toHaveLength(2);
  });

  it("never fails the action it follows", async () => {
    const limits = setup(realNow, () => Promise.reject(new Error("connection lost")));
    await expect(limits.record("anna", "item_photo")).resolves.toBeUndefined();
    expect(logged).toEqual([]);
  });
});

describe("monthly spend per user", () => {
  it("stops a user at $5 of AI in the month, and no one else", async () => {
    const { usageRepository } = createInMemoryRepositories();
    const limits = createLimits(usageRepository, { dailyUsd: 100, userMonthlyUsd: 5 });
    // Briefs and outfits so far this month.
    await limits.spent("anna", "brief", 4_990_000);

    await limits.check("anna", "item_photo");
    await limits.record("anna", "item_photo");
    await expect(limits.check("anna", "item_photo")).rejects.toThrow("limit:monthly");
    await limits.check("maya", "item_photo");
    // A brief needs more room than a photo.
    expect(await limits.allows("anna", 100_000)).toBe(false);
    expect(await limits.allows("maya", 100_000)).toBe(true);
    // Saving a look is free, so it isn't stopped.
    await limits.check("anna", "inspiration");
  });

  it("opens again on the 1st", async () => {
    const { usageRepository } = createInMemoryRepositories();
    let now = new Date("2026-10-31T23:00:00Z");
    const limits = createLimits(
      usageRepository,
      { dailyUsd: 100, userMonthlyUsd: 5 },
      new Set(),
      () => now,
    );
    await limits.spent("anna", "brief", 5_000_000);
    expect(await limits.allows("anna", 100_000)).toBe(false);
    // The in-memory rows are stamped with the real time, so look from a month after it.
    now = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1, 0, 1));
    expect(await limits.allows("anna", 100_000)).toBe(true);
  });

  it("lets a brief through only while the server's day has room too", async () => {
    const { usageRepository } = createInMemoryRepositories();
    const limits = createLimits(usageRepository, { dailyUsd: 0.15, userMonthlyUsd: 5 });
    await limits.spent("maya", "brief", 100_000);
    expect(await limits.allows("anna", 100_000)).toBe(false);
  });
});

describe("testers", () => {
  it("get 30 outfit requests a day and no monthly cap; others keep 5", async () => {
    const { usageRepository } = createInMemoryRepositories();
    const limits = createLimits(
      usageRepository,
      { dailyUsd: 3, userMonthlyUsd: 5 },
      new Set(["tester"]),
    );
    for (let i = 0; i < 30; i++) {
      await limits.check("tester", "wear_with");
      await limits.record("tester", "wear_with");
    }
    await expect(limits.check("tester", "wear_with")).rejects.toThrow("limit:wear_with");
    expect((await limits.summary("tester")).wear_with).toMatchObject({ used: 30, limit: 30 });
    expect((await limits.summary("someone")).wear_with.limit).toBe(5);
  });
});

describe("periods", () => {
  const now = new Date("2026-10-21T15:30:00Z"); // a Wednesday

  it("start at midnight UTC, on Monday, and on the 1st", () => {
    expect(periodStart("day", now).toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(periodStart("week", now).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(periodStart("month", now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("reset at the next one, across the year end", () => {
    expect(nextPeriodStart("week", now).toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(nextPeriodStart("month", new Date("2026-12-31T23:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});
