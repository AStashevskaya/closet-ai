import type { Item, UploadedPhoto } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import {
  deleteUnattachedPhotos,
  PermanentPhotoError,
  type PhotoJobDeps,
  UNATTACHED_PHOTO_TTL_MS,
} from "../src/modules/photos/photo-jobs";
import { createMemoryStorage, type Storage } from "../src/storage/storage";
import { createInMemoryRepositories, createManualPhotoQueue, testEnv as env } from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;
let storage: Storage;
let queue: ReturnType<typeof createManualPhotoQueue>;
// What the worker gets: the same photos store and storage as the API.
let jobDeps: PhotoJobDeps;

async function setup() {
  storage = createMemoryStorage();
  queue = createManualPhotoQueue();
  const repositories = createInMemoryRepositories();
  jobDeps = { photos: repositories.photosRepository, storage };
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({ env, auth, ...repositories, photoQueue: queue.photoQueue, storage });
  return app;
}

// The worker's turn: process everything that was queued.
const runWorker = () => queue.runAll(jobDeps);

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

  it("answers at once and queues the photo for processing", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");

    const res = await upload(server, cookie, await cameraPhoto());
    expect(res.statusCode).toBe(201);
    const { photoKey, status } = res.json<UploadedPhoto>();
    expect(photoKey).toMatch(/^photos\/[^/]+\/[0-9a-f-]{36}\.webp$/);
    expect(status).toBe("processing");
    expect(queue.queued).toEqual([photoKey]);
    // Nothing processed yet: the WebP appears only after the worker has run.
    expect(await storage.exists(photoKey)).toBe(false);
  });

  it("the worker stores a small WebP without metadata and deletes the original", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const original = await cameraPhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const { photoKey } = (await upload(server, cookie, original)).json<UploadedPhoto>();
    const { uploadKey } = (await jobDeps.photos.get(photoKey))!;
    expect(await storage.exists(uploadKey!)).toBe(true);
    await runWorker();

    const stored = await storage.get(photoKey);
    const meta = await sharp(stored!.body).metadata();
    expect(stored!.contentType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width, meta.height)).toBe(1024);
    expect(meta.exif).toBeUndefined();
    expect(stored!.body.length).toBeLessThan(original.length);
    expect(await storage.exists(uploadKey!)).toBe(false);
    expect((await jobDeps.photos.get(photoKey))!.status).toBe("ready");
  });

  it("rejects a file that is not an image", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const res = await upload(server, cookie, new TextEncoder().encode("not a photo"));
    expect(res.statusCode).toBe(415);
    expect(queue.queued).toEqual([]);
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

  it("attaches a photo that is still processing, and serves it to the owner once ready", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { photoKey } = (await upload(server, anna, await cameraPhoto())).json<UploadedPhoto>();

    // The app saves the item right after the upload, before the worker has run.
    const created = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie: anna },
      payload: { ...shirt, photoKey },
    });
    expect(created.statusCode).toBe(201);
    const { id, photoUrl: pending, photoStatus } = created.json<Item>();
    expect(photoStatus).toBe("processing");
    expect(pending).toBeUndefined();

    await runWorker();
    const [listed] = (
      await server.inject({ method: "GET", url: "/api/items", headers: { cookie: anna } })
    ).json<Item[]>();
    expect(listed!.photoStatus).toBe("ready");
    const photoUrl = listed!.photoUrl;
    expect(photoUrl).toBe(`/api/items/${id}/photo`);

    const own = await server.inject({ method: "GET", url: photoUrl!, headers: { cookie: anna } });
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("image/webp");
    expect(own.headers["cache-control"]).toContain("private");

    const other = await server.inject({ method: "GET", url: photoUrl!, headers: { cookie: maya } });
    expect(other.statusCode).toBe(404);
  });

  it("deletes the photo file together with the item", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    await runWorker();
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { ...shirt, photoKey },
      })
    ).json<Item>();

    const res = await server.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await storage.exists(photoKey)).toBe(false);
    expect(await jobDeps.photos.get(photoKey)).toBeNull();
  });

  it("deletes the original too when the item goes before its photo was processed", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    const { uploadKey } = (await jobDeps.photos.get(photoKey))!;
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { ...shirt, photoKey },
      })
    ).json<Item>();

    await server.inject({ method: "DELETE", url: `/api/items/${id}`, headers: { cookie } });
    expect(await storage.exists(uploadKey!)).toBe(false);
    // The job that was still queued finds nothing to do.
    await runWorker();
    expect(await storage.exists(photoKey)).toBe(false);
  });

  it("still deletes the item when the storage fails", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { ...shirt, photoKey },
      })
    ).json<Item>();
    storage.delete = () => Promise.reject(new Error("S3 is down"));

    const res = await server.inject({
      method: "DELETE",
      url: `/api/items/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    const list = await server.inject({ method: "GET", url: "/api/items", headers: { cookie } });
    expect(list.json<Item[]>()).toEqual([]);
    // The photo is left unattached, so the cleanup job will try again.
    expect(await jobDeps.photos.get(photoKey)).not.toBeNull();
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

describe("worker jobs", () => {
  // The BullMQ worker turns a PermanentPhotoError into "failed" without retrying.
  it("treats a missing original as a permanent error", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    const { uploadKey } = (await jobDeps.photos.get(photoKey))!;
    await storage.delete(uploadKey!);

    await expect(runWorker()).rejects.toThrow(PermanentPhotoError);
  });

  it("refuses to attach a photo that failed", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    await jobDeps.photos.markFailed(photoKey);

    const res = await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { name: "Shirt", category: "top", colors: ["white"], photoKey },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cleans up photos that were never attached to an item, after a day", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey: abandoned } = (
      await upload(server, cookie, await cameraPhoto())
    ).json<UploadedPhoto>();
    const { photoKey: attached } = (
      await upload(server, cookie, await cameraPhoto())
    ).json<UploadedPhoto>();
    await runWorker();
    await server.inject({
      method: "POST",
      url: "/api/items",
      headers: { cookie },
      payload: { name: "Shirt", category: "top", colors: ["white"], photoKey: attached },
    });

    // Too early: the user may still be filling in the form.
    expect(await deleteUnattachedPhotos(jobDeps)).toBe(0);

    const tomorrow = new Date(Date.now() + UNATTACHED_PHOTO_TTL_MS + 1000);
    expect(await deleteUnattachedPhotos(jobDeps, tomorrow)).toBe(1);
    expect(await storage.exists(abandoned)).toBe(false);
    expect(await jobDeps.photos.get(abandoned)).toBeNull();
    expect(await storage.exists(attached)).toBe(true);
  });
});
