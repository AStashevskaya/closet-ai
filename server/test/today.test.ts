import type { TodayWeek } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { createMemoryStorage } from "../src/storage/storage";
import type { WeatherClient } from "../src/weather/weather";
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

const week = [
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
];
const stubWeather = (answer: "ok" | "none" | "down" = "ok"): WeatherClient => ({
  week: async () => {
    if (answer === "down") throw new Error("offline");
    if (answer === "none") return null;
    return {
      place: "Минск",
      today: "2026-11-12",
      days: week.map((date) => ({ date, max: 8, min: 2, sky: "rain", wet: 70 })),
    };
  },
});

async function setup(weather: WeatherClient | null) {
  const repositories = createInMemoryRepositories(() => new Date("2026-11-12T08:00:00Z"));
  app = await buildApp({
    env,
    auth: createAuth(env, memoryAdapter({ user: [], session: [], account: [], verification: [] })),
    ...repositories,
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    storage: createMemoryStorage(),
    taggingEnabled: true,
    stylistEnabled: true,
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
  const read = async () =>
    (
      await app!.inject({ method: "GET", url: "/api/today?lang=ru", headers: { cookie } })
    ).json<TodayWeek>();
  const setCity = (city: string) =>
    app!.inject({ method: "PATCH", url: "/api/profile", headers: { cookie }, payload: { city } });
  return { read, setCity };
}

describe("GET /api/today", () => {
  it("asks for a city first, then gives her week with its weather", async () => {
    const { read, setCity } = await setup(stubWeather());
    expect(await read()).toEqual({ status: "no-city", place: null, today: null, days: [] });

    await setCity("Minsk");
    const answer = await read();
    expect(answer).toMatchObject({ status: "ok", place: "Минск", today: "2026-11-12" });
    expect(answer.days).toHaveLength(7);
    expect(answer.days[3]).toEqual({
      date: "2026-11-12",
      max: 8,
      min: 2,
      sky: "rain",
      wet: 70,
      wore: false,
    });
  });

  it("says why there's no weather: an unknown city, a service down, none configured", async () => {
    for (const [weather, status] of [
      [stubWeather("none"), "not-found"],
      [stubWeather("down"), "unavailable"],
      [null, "unavailable"],
    ] as const) {
      const { read, setCity } = await setup(weather);
      await setCity("Atlantis");
      expect((await read()).status).toBe(status);
      await app!.close();
      app = undefined;
    }
  });
});
