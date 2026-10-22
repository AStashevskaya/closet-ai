import type { CatalogItem } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
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
  const repositories = createInMemoryRepositories();
  const storage = createMemoryStorage();
  app = await buildApp({
    env,
    auth: createAuth(env, memoryAdapter({ user: [], session: [], account: [], verification: [] })),
    ...repositories,
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    storage,
    taggingEnabled: true,
    stylistEnabled: true,
  });
  return { server: app, catalog: repositories.catalogRepository, storage };
}

async function signUp(server: App, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: "correct-horse-battery" },
  });
  return res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

describe("/api/catalog/:id", () => {
  it("shows a partner item in the language asked for, and counts the card as opened", async () => {
    const { server, catalog } = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const boots = await catalog.add({ names: { en: "Ankle boots", ru: "Ботинки" } });

    const res = await server.inject({
      method: "GET",
      url: `/api/catalog/${boots.id}?lang=ru`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<CatalogItem>()).toEqual({
      id: boots.id,
      brand: "STUDIO EDIT",
      name: "Ботинки",
      category: "shoes",
      colors: ["black"],
      price: 459,
      currency: "ILS",
      url: boots.url,
      imageUrl: expect.stringMatching(new RegExp(`^/api/catalog/${boots.id}/photo\\?v=`)) as string,
      inStock: true,
      demo: true,
    });
    expect(catalog.events).toEqual([
      { catalogItemId: boots.id, userId: expect.any(String) as string, event: "opened" },
    ]);

    // No Hebrew name in the feed: English.
    const he = await server.inject({
      method: "GET",
      url: `/api/catalog/${boots.id}?lang=he`,
      headers: { cookie },
    });
    expect(he.json<CatalogItem>().name).toBe("Ankle boots");
  });

  it("serves the picture to any signed-in user, and nothing without a session", async () => {
    const { server, catalog, storage } = await setup();
    const boots = await catalog.add();
    const webp = await sharp({
      create: { width: 4, height: 4, channels: 4, background: "#000" },
    })
      .webp()
      .toBuffer();
    await storage.put(boots.imageKey, webp, "image/webp");

    expect(
      (await server.inject({ method: "GET", url: `/api/catalog/${boots.id}` })).statusCode,
    ).toBe(401);
    const cookie = await signUp(server, "boris@example.com");
    const photo = await server.inject({
      method: "GET",
      url: `/api/catalog/${boots.id}/photo`,
      headers: { cookie },
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/webp");
  });

  it("answers 404 for an item that isn't in the catalog", async () => {
    const { server } = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const res = await server.inject({
      method: "GET",
      url: "/api/catalog/00000000-0000-4000-8000-000000000000",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
