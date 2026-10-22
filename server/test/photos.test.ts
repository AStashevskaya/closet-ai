import type { Item, ItemDetail, PhotoState, SimilarItem, UploadedPhoto } from "@closet-ai/shared";
import { memoryAdapter } from "better-auth/adapters/memory";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type { BackgroundRemover } from "../src/ai/background-remover";
import { TaggingRefusedError, type ItemTagger } from "../src/ai/item-tagger";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import {
  cutOutPhoto,
  deleteUnattachedPhotos,
  PermanentPhotoError,
  type PhotoJobDeps,
  UNATTACHED_PHOTO_TTL_MS,
} from "../src/modules/photos/photo-jobs";
import { keyVersion } from "../src/modules/items/items.repository";
import { createMemoryStorage, type Storage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  createStubEmbedder,
  createStubRemover,
  createStubTagger,
  lookItems,
  shirtTags,
  testEnv as env,
  unitVector,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;
let storage: Storage;
let queue: ReturnType<typeof createManualPhotoQueue>;
// What the worker gets: the same photos store and storage as the API.
let jobDeps: PhotoJobDeps;

let stub: ReturnType<typeof createStubTagger>;
let embedding: ReturnType<typeof createStubEmbedder>;

// Tagging is on by default, with a stub instead of Claude; pass tagger: null to turn it off.
// Background removal is off unless a remover is passed.
let catalog: ReturnType<typeof createInMemoryRepositories>["catalogRepository"];

async function setup({
  tagger,
  remover = null,
}: { tagger?: ItemTagger | null; remover?: BackgroundRemover | null } = {}) {
  storage = createMemoryStorage();
  queue = createManualPhotoQueue();
  stub = createStubTagger();
  embedding = createStubEmbedder();
  const activeTagger = tagger === undefined ? stub.tagger : tagger;
  const repositories = createInMemoryRepositories();
  catalog = repositories.catalogRepository;
  jobDeps = {
    photos: repositories.photosRepository,
    storage,
    tagger: activeTagger,
    embedder: embedding.embedder,
    remover,
    catalog,
    queue: queue.photoQueue,
  };
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
  );
  app = await buildApp({
    env,
    auth,
    ...repositories,
    photoQueue: queue.photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    stylistEnabled: false,
    storage,
    taggingEnabled: activeTagger !== null,
  });
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
// Made once: encoding it is the slowest part of these tests.
let cameraPhotoBytes: Promise<Buffer> | undefined;
function cameraPhoto() {
  cameraPhotoBytes ??= makeCameraPhoto();
  return cameraPhotoBytes;
}

function makeCameraPhoto() {
  return sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 180, g: 120, b: 140 } },
  })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Make: "TestPhone", Model: "Camera 1" } })
    .toBuffer();
}

function upload(server: App, cookie: string, bytes: Uint8Array, type = "image/jpeg", query = "") {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), "photo.jpg");
  return server.inject({
    method: "POST",
    url: `/api/photos${query}`,
    headers: { cookie },
    payload: form,
  });
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
    expect(queue.queued).toEqual([{ name: "process", key: photoKey, lang: "en" }]);
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
    // 3000 × 2000 kept to about 2.6 MP.
    expect(Math.max(meta.width, meta.height)).toBe(1975);
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
    expect(photoUrl).toMatch(new RegExp(`^/api/items/${id}/photo\\?v=[0-9a-f]{8}$`));

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

describe("tagging", () => {
  const status = (server: App, cookie: string, key: string) =>
    server.inject({
      method: "GET",
      url: `/api/photos/status?key=${encodeURIComponent(key)}`,
      headers: { cookie },
    });

  it("tags the processed photo in the language the app asked for", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (
      await upload(server, cookie, await cameraPhoto(), "image/jpeg", "?lang=ru")
    ).json<UploadedPhoto>();

    expect((await status(server, cookie, photoKey)).json<PhotoState>()).toEqual({
      status: "processing",
      tagStatus: "pending",
      tags: null,
      lookItems: null,
      matches: null,
    });

    await runWorker();
    expect((await status(server, cookie, photoKey)).json<PhotoState>()).toEqual({
      status: "ready",
      tagStatus: "done",
      tags: shirtTags,
      lookItems: null,
      matches: null,
    });
    // One call, on the small WebP rather than the 3000 px original.
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.lang).toBe("ru");
    expect(stub.calls[0]!.bytes).toBe((await storage.get(photoKey))!.body.length);
  });

  it("shows the tags on the item", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    await runWorker();
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name: "Shirt", category: "top", colors: ["white"], photoKey },
      })
    ).json<Item>();

    const res = await server.inject({
      method: "GET",
      url: `/api/items/${id}`,
      headers: { cookie },
    });
    expect(res.json<ItemDetail>().tags).toEqual(shirtTags);
  });

  it("shows a photo's status only to its owner", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { photoKey } = (await upload(server, anna, await cameraPhoto())).json<UploadedPhoto>();

    expect((await status(server, maya, photoKey)).statusCode).toBe(404);
    expect((await status(server, anna, "photos/nobody/missing.webp")).statusCode).toBe(404);
    expect((await status(server, "", photoKey)).statusCode).toBe(401);
  });

  it("leaves photos untagged when no tagger is configured", async () => {
    const server = await setup({ tagger: null });
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();

    await runWorker();
    expect((await status(server, cookie, photoKey)).json<PhotoState>()).toEqual({
      status: "ready",
      tagStatus: null,
      tags: null,
      lookItems: null,
      matches: null,
    });
  });

  it("treats a refusal as final, and other errors as worth a retry", async () => {
    const refused = await setup({
      tagger: createStubTagger(() => Promise.reject(new TaggingRefusedError("declined"))).tagger,
    });
    const cookie = await signUp(refused, "anna@example.com");
    await upload(refused, cookie, await cameraPhoto());
    await expect(runWorker()).rejects.toThrow(PermanentPhotoError);
    await refused.close();

    const flaky = await setup({
      tagger: createStubTagger(() => Promise.reject(new Error("overloaded"))).tagger,
    });
    const other = await signUp(flaky, "maya@example.com");
    const { photoKey } = (await upload(flaky, other, await cameraPhoto())).json<UploadedPhoto>();
    await expect(runWorker()).rejects.toThrow("overloaded");
    expect(queue.queued.some((job) => job.name === "tag")).toBe(false);
    // Still pending: BullMQ retries the job.
    expect((await status(flaky, other, photoKey)).json<PhotoState>().tagStatus).toBe("pending");
  });
});

describe("embeddings and similar items", () => {
  // Uploads a photo, lets the worker process it, and saves an item with it.
  async function addItem(server: App, cookie: string, name: string, category = "top") {
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    await runWorker();
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name, category, colors: ["white"], photoKey },
      })
    ).json<Item>();
    return { id, photoKey };
  }

  const similar = (server: App, cookie: string, id: string) =>
    server.inject({ method: "GET", url: `/api/items/${id}/similar`, headers: { cookie } });

  it("embeds the processed photo", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();

    await runWorker();
    // Once, on the small WebP rather than the original.
    expect(embedding.calls).toEqual([{ bytes: (await storage.get(photoKey))!.body.length }]);
    expect(await jobDeps.photos.listWithoutEmbedding()).toEqual([]);
  });

  it("finds the closest items of the same category, closest first", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const shirt = await addItem(server, cookie, "White shirt");
    const closeShirt = await addItem(server, cookie, "Cream shirt");
    const farShirt = await addItem(server, cookie, "Striped shirt");
    const shorts = await addItem(server, cookie, "White shorts", "bottom");
    await jobDeps.photos.setEmbedding(shirt.photoKey, unitVector(1, 0));
    await jobDeps.photos.setEmbedding(closeShirt.photoKey, unitVector(1, 0.2));
    await jobDeps.photos.setEmbedding(farShirt.photoKey, unitVector(0.2, 1));
    // Looks the same as the shirt, but another category.
    await jobDeps.photos.setEmbedding(shorts.photoKey, unitVector(1, 0));

    const res = await similar(server, cookie, shirt.id);
    expect(res.statusCode).toBe(200);
    const found = res.json<SimilarItem[]>();
    expect(found.map((item) => item.name)).toEqual(["Cream shirt", "Striped shirt"]);
    expect(found[0]!.similarity).toBeGreaterThan(0.9);
    expect(found[1]!.similarity).toBeLessThan(0.5);
  });

  it("is empty for an item whose photo has no embedding yet, 404 for someone else's", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie: anna },
        payload: { name: "No photo", category: "top", colors: ["white"] },
      })
    ).json<Item>();

    expect((await similar(server, anna, id)).json()).toEqual([]);
    expect((await similar(server, maya, id)).statusCode).toBe(404);
  });
});

describe("background removal", () => {
  async function addItem(server: App, cookie: string) {
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    await runWorker();
    const item = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name: "Shirt", category: "top", colors: ["white"], photoKey },
      })
    ).json<Item>();
    return { ...item, photoKey };
  }

  it("cuts the item out after processing and serves the cut-out to the owner", async () => {
    const cut = createStubRemover();
    const server = await setup({ remover: cut.remover });
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const { id, photoKey, photoUrl, cutoutUrl } = await addItem(server, anna);

    // The remover gets the small WebP, once.
    expect(cut.calls).toEqual([{ bytes: (await storage.get(photoKey))!.body.length }]);
    // Versioned by the stored key, so a turned photo gets a URL of its own.
    expect(photoUrl).toBe(`/api/items/${id}/photo?v=${keyVersion(photoKey)}`);
    expect(cutoutUrl).toBe(
      `/api/items/${id}/photo?variant=cutout&v=${keyVersion(photoKey.replace(/\.webp$/, "-cutout.webp"))}`,
    );

    const own = await server.inject({ method: "GET", url: cutoutUrl!, headers: { cookie: anna } });
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("image/webp");
    // Transparent, with the empty margins trimmed: the stub's item is a square in the middle of
    // a 1975 × 1317 photo, plus 6% padding on each side.
    const meta = await sharp(own.rawPayload).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBeLessThan(850);
    expect(meta.width).toBe(meta.height);

    // The photo itself is still the original one.
    const photo = await server.inject({ method: "GET", url: photoUrl!, headers: { cookie: anna } });
    expect((await sharp(photo.rawPayload).metadata()).width).toBe(1975);

    const other = await server.inject({
      method: "GET",
      url: cutoutUrl!,
      headers: { cookie: maya },
    });
    expect(other.statusCode).toBe(404);
  });

  it("gives a redone cut-out a URL of its own and deletes the old one", async () => {
    const cut = createStubRemover();
    const server = await setup({ remover: cut.remover });
    const anna = await signUp(server, "anna@example.com");
    const before = await addItem(server, anna);
    const old = (await jobDeps.photos.get(before.photoKey))!.cutoutKey!;

    await cutOutPhoto(jobDeps, before.photoKey);
    const after = (
      await server.inject({
        method: "GET",
        url: `/api/items/${before.id}`,
        headers: { cookie: anna },
      })
    ).json<Item>();
    expect(after.cutoutUrl).not.toBe(before.cutoutUrl);
    expect(after.photoUrl).toBe(before.photoUrl);
    expect(await storage.get(old)).toBeNull();
  });

  it("turns the photo and its cut-out a quarter, under new URLs", async () => {
    const cut = createStubRemover();
    const server = await setup({ remover: cut.remover });
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const before = await addItem(server, anna);
    queue.queued.length = 0;

    expect(
      (
        await server.inject({
          method: "POST",
          url: `/api/items/${before.id}/rotate`,
          headers: { cookie: maya },
        })
      ).statusCode,
    ).toBe(404);

    const res = await server.inject({
      method: "POST",
      url: `/api/items/${before.id}/rotate`,
      headers: { cookie: anna },
    });
    expect(res.statusCode).toBe(200);
    const after = res.json<ItemDetail>();
    expect(after.name).toBe("Shirt");
    expect(after.photoUrl).not.toBe(before.photoUrl);
    expect(after.cutoutUrl).not.toBe(before.cutoutUrl);

    // 1975 × 1317 before, so 1317 × 1975 now; the cut-out is turned too and keeps its transparency.
    const photo = await server.inject({
      method: "GET",
      url: after.photoUrl!,
      headers: { cookie: anna },
    });
    expect(await sharp(photo.rawPayload).metadata()).toMatchObject({ width: 1317, height: 1975 });
    const cutout = await server.inject({
      method: "GET",
      url: after.cutoutUrl!,
      headers: { cookie: anna },
    });
    expect(cutout.statusCode).toBe(200);
    expect((await sharp(cutout.rawPayload).metadata()).hasAlpha).toBe(true);

    // The old files are gone, and the turned photo is embedded again.
    expect(await storage.get(before.photoKey)).toBeNull();
    expect(queue.queued.map((job) => job.name)).toEqual(["embed"]);
    expect(queue.queued[0]!.key).not.toBe(before.photoKey);
  });

  it("can't turn an item without a photo", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const { id } = (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name: "No photo", category: "top", colors: ["white"] },
      })
    ).json<Item>();
    const res = await server.inject({
      method: "POST",
      url: `/api/items/${id}/rotate`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("embeds the cut-out on white instead of the photo with its background", async () => {
    const cut = createStubRemover();
    const server = await setup({ remover: cut.remover });
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();

    // The embed job waits for the cut-out.
    expect(queue.queued.map((job) => job.name)).toEqual(["process"]);
    await runWorker();
    expect(embedding.calls).toHaveLength(1);
    expect(embedding.calls[0]!.bytes).not.toBe((await storage.get(photoKey))!.body.length);
  });

  it("keeps the photo as it is while the cut-out isn't there", async () => {
    const server = await setup({
      remover: createStubRemover(async () => {
        throw new Error("fal.ai is down");
      }).remover,
    });
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();

    // The job fails, so the queue would retry it; the photo is ready all the same.
    await expect(runWorker()).rejects.toThrow("fal.ai is down");
    const photo = await jobDeps.photos.get(photoKey);
    expect(photo).toMatchObject({ status: "ready", cutoutKey: null });
    expect(await storage.exists(photoKey.replace(".webp", "-cutout.webp"))).toBe(false);
  });

  it("embeds the photo as it is when no item is found in it", async () => {
    const server = await setup({ remover: createStubRemover(async () => null).remover });
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();

    await runWorker();
    expect((await jobDeps.photos.get(photoKey))!.cutoutKey).toBeNull();
    expect(embedding.calls).toEqual([{ bytes: (await storage.get(photoKey))!.body.length }]);
  });

  it("doesn't cut out an item someone is wearing, and embeds the photo as it is", async () => {
    const cut = createStubRemover();
    const worn = createStubTagger(undefined, undefined, { onPerson: true });
    const server = await setup({ tagger: worn.tagger, remover: cut.remover });
    const cookie = await signUp(server, "anna@example.com");
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();

    await runWorker();
    expect(cut.calls).toEqual([]);
    const photo = await jobDeps.photos.get(photoKey);
    expect(photo).toMatchObject({ cutoutKey: null, tags: shirtTags });
    expect(embedding.calls).toEqual([{ bytes: (await storage.get(photoKey))!.body.length }]);
  });

  it("deletes the cut-out together with the item", async () => {
    const server = await setup({ remover: createStubRemover().remover });
    const cookie = await signUp(server, "anna@example.com");
    const { id, photoKey } = await addItem(server, cookie);
    const cutoutKey = (await jobDeps.photos.get(photoKey))!.cutoutKey!;
    expect(await storage.exists(cutoutKey)).toBe(true);

    await server.inject({ method: "DELETE", url: `/api/items/${id}`, headers: { cookie } });
    expect(await storage.exists(cutoutKey)).toBe(false);
    expect(await storage.exists(photoKey)).toBe(false);
  });
});

describe("items from a look photo", () => {
  const status = (server: App, cookie: string, key: string) =>
    server.inject({
      method: "GET",
      url: `/api/photos/status?key=${encodeURIComponent(key)}`,
      headers: { cookie },
    });

  const uploadLook = async (server: App, cookie: string) =>
    (
      await upload(server, cookie, await cameraPhoto(), "image/jpeg", "?lang=ru&kind=look")
    ).json<UploadedPhoto>().photoKey;

  const addFromLook = (server: App, cookie: string, payload: object) =>
    server.inject({ method: "POST", url: "/api/photos/look-items", headers: { cookie }, payload });

  const picked = (index: number, name: string, category = "top") => ({
    index,
    name,
    category,
    colors: ["pink"],
    seasons: ["summer"],
  });

  it("finds the items on a look and neither cuts it out nor embeds it", async () => {
    const server = await setup({ remover: createStubRemover().remover });
    const cookie = await signUp(server, "anna@example.com");
    const photoKey = await uploadLook(server, cookie);

    await runWorker();
    expect(stub.calls).toEqual([expect.objectContaining({ kind: "look", lang: "ru" })]);
    expect(embedding.calls).toEqual([]);
    const state = (await status(server, cookie, photoKey)).json<PhotoState>();
    expect(state).toMatchObject({ status: "ready", tagStatus: "done", tags: null });
    expect(state.lookItems!.map((item) => item.name)).toEqual([
      "Pink mesh top",
      "Blue wide-leg jeans",
    ]);
  });

  it("adds the picked items, each with the look cropped to its box", async () => {
    const server = await setup({ remover: createStubRemover().remover });
    const cookie = await signUp(server, "anna@example.com");
    const photoKey = await uploadLook(server, cookie);
    await runWorker();

    const res = await addFromLook(server, cookie, {
      photoKey,
      items: [picked(1, "Мои любимые джинсы", "bottom")],
    });
    expect(res.statusCode).toBe(201);
    const [jeans] = res.json<Item[]>();
    expect(jeans).toMatchObject({
      name: "Мои любимые джинсы",
      category: "bottom",
      photoStatus: "ready",
    });

    // The crop is the jeans' box (60% × 50% of the 1975 × 1317 look) plus a small margin.
    const photo = await server.inject({
      method: "GET",
      url: jeans!.photoUrl!,
      headers: { cookie },
    });
    const { width = 0, height = 0 } = await sharp(photo.rawPayload).metadata();
    expect(width).toBeGreaterThan(1200);
    expect(width).toBeLessThan(1360);
    expect(height).toBeGreaterThan(660);
    expect(height).toBeLessThan(780);

    // The model's details stay on the item; the user's name and colours win.
    const detail = (
      await server.inject({ method: "GET", url: `/api/items/${jeans!.id}`, headers: { cookie } })
    ).json<ItemDetail>();
    expect(detail.tags).toMatchObject({ fabric: "denim", colors: ["pink"], recognized: true });

    // Embedded, but not cut out: the crop shows the person wearing it.
    expect(queue.queued.map((job) => job.name)).toEqual(["embed"]);
    await runWorker();
    expect(embedding.calls).toHaveLength(1);
    expect(detail.cutoutUrl).toBeUndefined();
  });

  it("refuses someone else's look, a look not read yet, a missing item and an item photo", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const look = await uploadLook(server, anna);

    expect(
      (await addFromLook(server, anna, { photoKey: look, items: [picked(0, "Top")] })).statusCode,
    ).toBe(409);
    await runWorker();
    expect(
      (await addFromLook(server, maya, { photoKey: look, items: [picked(0, "Top")] })).statusCode,
    ).toBe(404);
    expect(
      (await addFromLook(server, anna, { photoKey: look, items: [picked(5, "Top")] })).statusCode,
    ).toBe(400);

    const { photoKey: itemPhoto } = (
      await upload(server, anna, await cameraPhoto())
    ).json<UploadedPhoto>();
    await runWorker();
    expect(
      (await addFromLook(server, anna, { photoKey: itemPhoto, items: [picked(0, "Top")] }))
        .statusCode,
    ).toBe(404);
  });
});

describe("want / can: a look matched against the wardrobe", () => {
  const status = async (server: App, cookie: string, key: string) =>
    (
      await server.inject({
        method: "GET",
        url: `/api/photos/status?key=${encodeURIComponent(key)}`,
        headers: { cookie },
      })
    ).json<PhotoState>();

  async function addItem(server: App, cookie: string, name: string, category = "top") {
    const { photoKey } = (await upload(server, cookie, await cameraPhoto())).json<UploadedPhoto>();
    await runWorker();
    return (
      await server.inject({
        method: "POST",
        url: "/api/items",
        headers: { cookie },
        payload: { name, category, colors: ["pink"], photoKey },
      })
    ).json<Item>();
  }

  const uploadWant = async (server: App, cookie: string) =>
    (
      await upload(server, cookie, await cameraPhoto(), "image/jpeg", "?kind=want")
    ).json<UploadedPhoto>().photoKey;

  it("finds the look's items and the wardrobe items that match them", async () => {
    const cut = createStubRemover();
    const server = await setup({ remover: cut.remover });
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const top = await addItem(server, anna, "My pink top");
    await addItem(server, maya, "Maya's top");
    cut.calls.length = 0;

    const photoKey = await uploadWant(server, anna);
    await runWorker();

    const state = await status(server, anna, photoKey);
    expect(state.tagStatus).toBe("done");
    expect(state.lookItems!.map((item) => item.name)).toEqual([
      "Pink mesh top",
      "Blue wide-leg jeans",
    ]);
    // The top is compared with Anna's top only; no bottoms in her wardrobe, so no comparison.
    expect(stub.compared).toEqual([["My pink top"]]);
    expect(state.matches!.map(({ how, item }) => [how, item?.id ?? null])).toEqual([
      ["same", top.id],
      ["none", null],
    ]);
    expect(state.matches![0]!.item).toMatchObject({ name: "My pink top", category: "top" });
    // Each look item is cut out before it is embedded; the look itself is neither.
    expect(cut.calls).toHaveLength(2);
    expect((await jobDeps.photos.get(photoKey))!.cutoutKey).toBeNull();
  });

  it("offers close partner pieces for each item, in the language asked for", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    // The stub embeds every photo as unitVector(1).
    const mesh = await catalog.add({
      category: "top",
      names: { en: "Mesh top", ru: "Топ-сетка" },
      embedding: unitVector(1),
    });
    // Too far from the item to offer, and a category the look has no item in.
    await catalog.add({ category: "top", embedding: unitVector(0, 1) });
    await catalog.add({ category: "dress", embedding: unitVector(1) });

    const look = await uploadWant(server, anna);
    await runWorker();

    const res = await server.inject({
      method: "GET",
      url: `/api/photos/status?key=${encodeURIComponent(look)}&lang=ru`,
      headers: { cookie: anna },
    });
    const { matches } = res.json<PhotoState>();
    expect(matches!.map((m) => m.shop.map((offer) => offer.name))).toEqual([["Топ-сетка"], []]);
    expect(matches![0]!.shop[0]).toMatchObject({ id: mesh.id, demo: true, price: 459 });
    expect(catalog.events.map((e) => [e.catalogItemId, e.event])).toEqual([[mesh.id, "shown"]]);
  });

  it("offers only the same kind of accessory: a bag for a bag, not a hat", async () => {
    const bag = { ...lookItems[0]!, name: "Black tote", category: "accessory" as const };
    const server = await setup({
      tagger: createStubTagger(undefined, async () => [{ ...bag, noun: "leather tote bag" }]).tagger,
    });
    const anna = await signUp(server, "anna@example.com");
    // The hat is closer by embedding, the bag close enough.
    await catalog.add({ category: "accessory", names: { en: "Bucket hat" } });
    const tote = await catalog.add({
      category: "accessory",
      names: { en: "Tote bag" },
      embedding: unitVector(1, 0.5),
    });

    const look = await uploadWant(server, anna);
    await runWorker();
    const { matches } = await status(server, anna, look);
    expect(matches![0]!.shop.map((offer) => offer.id)).toEqual([tote.id]);
  });

  it("answers none when the model sees no match", async () => {
    const server = await setup({
      tagger: createStubTagger(undefined, undefined, {
        verdict: async () => ({ how: "none", index: null }),
      }).tagger,
    });
    const cookie = await signUp(server, "anna@example.com");
    await addItem(server, cookie, "Black tee");
    const look = await uploadWant(server, cookie);
    await runWorker();
    expect((await status(server, cookie, look)).matches!.map((match) => match.how)).toEqual([
      "none",
      "none",
    ]);
  });

  it("answers none once the matched item is deleted", async () => {
    const server = await setup();
    const cookie = await signUp(server, "anna@example.com");
    const top = await addItem(server, cookie, "Pink top");
    const look = await uploadWant(server, cookie);
    await runWorker();
    expect((await status(server, cookie, look)).matches![0]!.how).toBe("same");

    await server.inject({ method: "DELETE", url: `/api/items/${top.id}`, headers: { cookie } });
    expect((await status(server, cookie, look)).matches![0]).toEqual({ how: "none", item: null, shop: [] });
  });

  it("can't be read by someone else", async () => {
    const server = await setup();
    const anna = await signUp(server, "anna@example.com");
    const maya = await signUp(server, "maya@example.com");
    const look = await uploadWant(server, anna);
    await runWorker();
    const res = await server.inject({
      method: "GET",
      url: `/api/photos/status?key=${encodeURIComponent(look)}`,
      headers: { cookie: maya },
    });
    expect(res.statusCode).toBe(404);
  });
});
