import type { UserProfile } from "@closet-ai/shared";
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

async function setup() {
  app = await buildApp({
    env,
    auth: createAuth(env, memoryAdapter({ user: [], session: [], account: [], verification: [] })),
    ...createInMemoryRepositories(),
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    storage: createMemoryStorage(),
    taggingEnabled: true,
    stylistEnabled: true,
  });
  return app;
}

async function signUp(server: App, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: "correct-horse-battery" },
  });
  return res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

describe("/api/profile", () => {
  it("starts empty, saves only the fields sent, and is each user's own", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const boris = await signUp(server, "boris@example.com");
    const read = async (cookie: string) =>
      (
        await server.inject({ method: "GET", url: "/api/profile", headers: { cookie } })
      ).json<UserProfile>();
    const patch = (cookie: string, payload: object) =>
      server.inject({ method: "PATCH", url: "/api/profile", headers: { cookie }, payload });

    expect(await read(anna)).toMatchObject({ country: null, sizeTop: null, bodyShape: null });

    await patch(anna, { country: "IL", city: " Tel Aviv ", birthYear: 1994, heightCm: 168 });
    const saved = await patch(anna, { sizeTop: "S", sizeShoes: "38", bodyShape: "hourglass" });
    expect(saved.json<UserProfile>()).toEqual({
      country: "IL",
      city: "Tel Aviv",
      birthYear: 1994,
      heightCm: 168,
      bodyShape: "hourglass",
      sizeTop: "S",
      sizeBottom: null,
      sizeShoes: "38",
    });
    expect((await patch(anna, { city: null })).json<UserProfile>().city).toBeNull();
    expect((await read(boris)).country).toBeNull();
  });

  it("refuses what isn't a country, an age under 13, or an unlikely height", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const tooYoung = new Date().getFullYear() - 10;
    for (const payload of [{ country: "Israel" }, { birthYear: tooYoung }, { heightCm: 300 }]) {
      const res = await server.inject({
        method: "PATCH",
        url: "/api/profile",
        headers: { cookie: anna },
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("needs a session", async () => {
    const server = await setup();
    expect((await server.inject({ method: "GET", url: "/api/profile" })).statusCode).toBe(401);
  });
});
