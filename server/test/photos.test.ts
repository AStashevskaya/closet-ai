import type { Item, UploadedPhoto } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { createMemoryStorage, type Storage } from "../src/storage/storage";
import { createInMemoryItemsRepository, testEnv as env } from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;
let storage: Storage;

async function setup() {
  storage = createMemoryStorage();
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({ env, auth, itemsRepository: createInMemoryItemsRepository(), storage });
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

// A phone-sized JPEG with EXIF data, like a photo straight from the camera roll.
async function cameraPhoto() {
  return sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 120, b: 140 } },
  })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Make: "TestPhone", Model: "Camera 1" } })
    .toBuffer();
}

function upload(server: App, cookie: string, bytes: Uint8Array, type = "image/jpeg") {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), "photo.jpg");
  return server.inject({ method: "POST", url: "/api/photos", headers: { cookie }, payload: form });
}

describe("POST /api/photos", () => {
  it("requires a session", async () => {
    const server = await setup();
    const res = await upload(server, "", await cameraPhoto());
    expect(res.statusCode).toBe(401);
  });

  it("stores a small WebP without metadata under the user's prefix", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const original = await cameraPhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const res = await upload(server, cookie, original);
    expect(res.statusCode).toBe(201);
    const { photoKey } = res.json<UploadedPhoto>();
    expect(photoKey).toMatch(/^photos\/[^/]+\/[0-9a-f-]{36}\.webp$/);

    const stored = await storage.get(photoKey);
    const meta = await sharp(stored!.body).metadata();
    expect(stored!.contentType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width, meta.height)).toBe(1024);
    expect(meta.exif).toBeUndefined();
    expect(stored!.body.length).toBeLessThan(original.length);
  });

  it("rejects a file that is not an image", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const res = await upload(server, cookie, new TextEncoder().encode("not a photo"));
    expect(res.statusCode).toBe(415);
  });

  it("rejects a file over the size limit", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const res = await upload(server, cookie, new Uint8Array(11 * 1024 * 1024));
    expect(res.statusCode).toBe(413);
  });
});

describe("item photos", () => {
  const shirt = { name: "White linen shirt", category: "top", colors: ["white"] };

  it("attaches an uploaded photo and serves it only to the owner", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { photoKey } = (await upload(server, anna, await cameraPhoto())).json<UploadedPhoto>();

    const created = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie: anna },
      payload: { ...shirt, photoKey },
    });
    expect(created.statusCode).toBe(201);
    const { id, photoUrl } = created.json<Item>();
    expect(photoUrl).toBe(`/api/items/${id}/photo`);

    const own = await server.inject({ method: "GET", url: photoUrl!, headers: { cookie: anna } });
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("image/webp");
    expect(own.headers["cache-control"]).toContain("private");

    const other = await server.inject({ method: "GET", url: photoUrl!, headers: { cookie: maya } });
    expect(other.statusCode).toBe(404);
  });

  it("refuses someone else's photo and keys that were never uploaded", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { photoKey: annasPhoto } = (
      await upload(server, anna, await cameraPhoto())
    ).json<UploadedPhoto>();
    const mayasPrefix = (await upload(server, maya, await cameraPhoto()))
      .json<UploadedPhoto>()
      .photoKey.replace(/[^/]+\.webp$/, "");

    for (const photoKey of [annasPhoto, `${mayasPrefix}never-uploaded.webp`]) {
      const res = await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: maya },
        payload: { ...shirt, photoKey },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
