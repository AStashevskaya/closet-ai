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

describe("testers", () => {
  it("get 30 outfit requests a day and no monthly cap; others keep 5", async () => {
    const { usageRepository } = createInMemoryRepositories();
    const limits = createLimits(usageRepository, 3, new Set(["tester"]));
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
