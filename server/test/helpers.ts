import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  AppLanguage,
  CreateItemInput,
  ItemTags,
  LookItem,
  OutfitReaction,
  UsageAction,
} from "@closet-ai/shared";
import type { BackgroundRemover } from "../src/ai/background-remover";
import { EMBEDDING_DIMENSIONS } from "../src/ai/embedding-model";
import type { ItemEmbedder } from "../src/ai/item-embedder";
import type { ItemTagger, MatchVerdict } from "../src/ai/item-tagger";
import type { BriefInput, ComposeInput, Stylist } from "../src/ai/stylist";
import type { Env } from "../src/config/env";
import { toItem, type ItemsRepository } from "../src/modules/items/items.repository";
import {
  cutOutPhoto,
  embedPhoto,
  processUploadedPhoto,
  tagPhoto,
  type PhotoJobDeps,
} from "../src/modules/photos/photo-jobs";
import type { Photo, PhotosRepository } from "../src/modules/photos/photos.repository";
import {
  checkBrief,
  composeOutfits,
  refreshBrief,
  type OutfitJobDeps,
  type OutfitQueue,
} from "../src/modules/outfits/outfit-jobs";
import {
  summarize,
  type NewOutfit,
  type OutfitRequestRow,
  type OutfitsRepository,
  type StyleBrief,
} from "../src/modules/outfits/outfits.repository";
import type { UsageRepository } from "../src/modules/usage/usage.repository";
import type { PhotoQueue } from "../src/queue/photo-queue";

// Shared by the test files. Not a test file itself (no .test.ts), so Vitest doesn't run it.
export const testEnv: Env = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgres://unused:unused@localhost:5432/unused",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:8333",
  S3_REGION: "auto",
  S3_BUCKET: "unused",
  S3_ACCESS_KEY_ID: "unused",
  S3_SECRET_ACCESS_KEY: "unused",
  REDIS_URL: "redis://localhost:6379",
  AI_DAILY_BUDGET_USD: 3,
  MODEL_CACHE_DIR: ".models",
};

// In-memory stand-ins for the Drizzle repositories. They share state the way the tables do:
// an item's photo status comes from the photos store, and a photo is unattached when no item points to it.
export function createInMemoryRepositories() {
  type ItemRow = { id: string; ownerId: string; input: CreateItemInput; createdAt: Date };
  const itemRows: ItemRow[] = [];
  const photoRows = new Map<string, Photo & { createdAt: Date; embedding?: number[] }>();

  const toApiItem = ({ id, ownerId, input, createdAt }: ItemRow) => {
    const { photoKey = null, seasons = [], ...rest } = input;
    const photo = photoKey ? photoRows.get(photoKey) : undefined;
    return toItem(
      { ...rest, seasons, id, ownerId, photoKey, createdAt },
      { photoStatus: photo?.status ?? null, cutoutKey: photo?.cutoutKey ?? null },
    );
  };

  const toDetail = (row: ItemRow) => {
    const photoKey = row.input.photoKey;
    return { ...toApiItem(row), tags: (photoKey && photoRows.get(photoKey)?.tags) || null };
  };

  const itemsRepository: ItemsRepository = {
    list: async (ownerId) => itemRows.filter((row) => row.ownerId === ownerId).map(toApiItem),
    create: async (ownerId, input) => {
      const row = { id: randomUUID(), ownerId, input, createdAt: new Date() };
      itemRows.push(row);
      return toApiItem(row);
    },
    get: async (ownerId, itemId) => {
      const row = itemRows.find((row) => row.ownerId === ownerId && row.id === itemId);
      return row ? toDetail(row) : null;
    },
    update: async (ownerId, itemId, patch) => {
      const row = itemRows.find((row) => row.ownerId === ownerId && row.id === itemId);
      if (!row) return null;
      row.input = { ...row.input, ...patch };
      return toDetail(row);
    },
    // The Drizzle version asks pgvector; here the vectors are unit length, so cosine = dot product.
    similar: async (ownerId, itemId, limit) => {
      const source = itemRows.find((row) => row.ownerId === ownerId && row.id === itemId);
      if (!source) return null;
      const embeddingOf = (row: ItemRow) =>
        row.input.photoKey ? photoRows.get(row.input.photoKey)?.embedding : undefined;
      const target = embeddingOf(source);
      if (!target) return [];
      return itemRows
        .filter(
          (row) =>
            row.ownerId === ownerId &&
            row.id !== itemId &&
            row.input.category === source.input.category &&
            embeddingOf(row),
        )
        .map((row) => ({ ...toApiItem(row), similarity: dot(embeddingOf(row)!, target) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    },
    photoKey: async (ownerId, itemId, variant) => {
      const photoKey = itemRows.find((row) => row.ownerId === ownerId && row.id === itemId)?.input
        .photoKey;
      if (!photoKey) return null;
      return variant === "cutout" ? (photoRows.get(photoKey)?.cutoutKey ?? null) : photoKey;
    },
    setPhotoKey: async (ownerId, itemId, photoKey) => {
      const row = itemRows.find((row) => row.ownerId === ownerId && row.id === itemId);
      if (!row) return false;
      row.input = { ...row.input, photoKey };
      return true;
    },
    delete: async (ownerId, itemId) => {
      const index = itemRows.findIndex((row) => row.ownerId === ownerId && row.id === itemId);
      if (index === -1) return null;
      const [row] = itemRows.splice(index, 1);
      return { photoKey: row?.input.photoKey ?? null };
    },
  };

  const photosRepository: PhotosRepository = {
    create: async (photo) => {
      photoRows.set(photo.key, {
        kind: "item",
        ...photo,
        status: "processing",
        tags: null,
        lookItems: null,
        matches: null,
        cutoutKey: null,
        createdAt: new Date(),
      });
    },
    createReady: async (photo) => {
      photoRows.set(photo.key, {
        ...photo,
        uploadKey: null,
        kind: "item",
        status: "ready",
        tagStatus: "done",
        lookItems: null,
        matches: null,
        cutoutKey: null,
        createdAt: new Date(),
      });
    },
    setLookItems: async (key, lookItems, matches) => {
      const row = photoRows.get(key);
      if (row) Object.assign(row, { tagStatus: "done", lookItems, matches: matches ?? null });
    },
    closestItems: async (ownerId, category, embedding, limit) =>
      itemRows
        .filter((row) => row.ownerId === ownerId && row.input.category === category)
        .flatMap((row) => {
          const photo = row.input.photoKey ? photoRows.get(row.input.photoKey) : undefined;
          if (!photo?.embedding) return [];
          return [
            {
              itemId: row.id,
              name: row.input.name,
              photoKey: photo.key,
              cutoutKey: photo.cutoutKey,
              similarity: dot(photo.embedding, embedding),
            },
          ];
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit),
    get: async (key) => {
      const row = photoRows.get(key);
      if (!row) return null;
      const { createdAt: _createdAt, embedding: _embedding, ...photo } = row;
      return photo;
    },
    copyAs: async (key, copy) => {
      const row = photoRows.get(key);
      if (!row) throw new Error(`no photo ${key}`);
      photoRows.set(copy.key, { ...row, ...copy, uploadKey: null, createdAt: new Date() });
    },
    markReady: async (key) => {
      const row = photoRows.get(key);
      if (row) Object.assign(row, { status: "ready", uploadKey: null });
    },
    markFailed: async (key) => {
      const row = photoRows.get(key);
      if (row) row.status = "failed";
    },
    setTags: async (key, tags) => {
      const row = photoRows.get(key);
      if (row) Object.assign(row, { tagStatus: "done", tags });
    },
    setEmbedding: async (key, embedding) => {
      const row = photoRows.get(key);
      if (row) row.embedding = embedding;
    },
    setCutout: async (key, cutoutKey) => {
      const row = photoRows.get(key);
      if (row) row.cutoutKey = cutoutKey;
    },
    listWithoutCutout: async () =>
      [...photoRows.values()]
        .filter((row) => row.status === "ready" && !row.cutoutKey)
        .map((row) => row.key),
    listWithoutEmbedding: async () =>
      [...photoRows.values()]
        .filter((row) => row.status === "ready" && !row.embedding)
        .map((row) => row.key),
    markTagsFailed: async (key) => {
      const row = photoRows.get(key);
      if (row) row.tagStatus = "failed";
    },
    listUnattached: async (before) =>
      [...photoRows.values()].filter(
        (row) =>
          row.createdAt < before &&
          !itemRows.some((item) => item.input.photoKey === row.key) &&
          !requests.some((request) => request.heroPhotoKey === row.key),
      ),
    delete: async (key) => {
      photoRows.delete(key);
    },
  };

  const usageRows: { userId: string; action: UsageAction; costMicros: number; createdAt: Date }[] =
    [];
  const usageRepository: UsageRepository = {
    record: async (userId, action, costMicros) => {
      usageRows.push({ userId, action, costMicros, createdAt: new Date() });
    },
    count: async (userId, action, since) =>
      usageRows.filter((r) => r.userId === userId && r.action === action && r.createdAt >= since)
        .length,
    spentSince: async (since) =>
      usageRows.filter((r) => r.createdAt >= since).reduce((sum, r) => sum + r.costMicros, 0),
  };

  // Outfits keep their own rows and read items and photos from the stores above.
  type Request = OutfitRequestRow & { createdAt: Date };
  type StoredOutfit = NewOutfit & { id: string; requestId: string; userId: string };
  const requests: Request[] = [];
  const storedOutfits: StoredOutfit[] = [];
  const reactions: {
    outfitId: string;
    userId: string;
    reaction: OutfitReaction;
    createdAt: Date;
  }[] = [];
  const briefs = new Map<string, StyleBrief>();
  const readyItems = (userId: string) =>
    itemRows.filter((row) => {
      const key = row.input.photoKey;
      return row.ownerId === userId && key && photoRows.get(key)?.status === "ready";
    });
  // Reactions within one test can share a millisecond; a counter keeps their order.
  let tick = 0;
  const now = () => new Date(Date.now() + tick++);

  const outfitsRepository: OutfitsRepository = {
    wardrobe: async (userId) =>
      readyItems(userId).map((row) => {
        const photo = photoRows.get(row.input.photoKey!)!;
        return {
          id: row.id,
          name: row.input.name,
          category: row.input.category,
          colors: row.input.colors,
          seasons: row.input.seasons ?? [],
          tags: photo.tags,
          imageKey: photo.cutoutKey ?? photo.key,
          embedding: photo.embedding ?? null,
        };
      }),
    wardrobeSize: async (userId) => readyItems(userId).length,
    createRequest: async (userId, hero, wardrobeSize) => {
      const id = randomUUID();
      requests.push({
        id,
        userId,
        itemId: null,
        heroPhotoKey: null,
        heroNoun: null,
        ...hero,
        status: "pending",
        wardrobeSize,
        createdAt: now(),
      });
      return id;
    },
    getRequest: async (id) => requests.find((r) => r.id === id) ?? null,
    latestDone: async (userId, itemId) =>
      requests
        .filter((r) => r.userId === userId && r.itemId === itemId && r.status === "done")
        .at(-1) ?? null,
    saveOutfits: async (requestId, userId, looks) => {
      for (const look of looks)
        storedOutfits.push({ ...look, id: randomUUID(), requestId, userId });
      const request = requests.find((r) => r.id === requestId);
      if (request) request.status = "done";
    },
    markFailed: async (requestId) => {
      const request = requests.find((r) => r.id === requestId);
      if (request) request.status = "failed";
    },
    view: async (requestId, userId) => {
      const request = requests.find((r) => r.id === requestId && r.userId === userId);
      if (!request) return null;
      return {
        id: request.id,
        status: request.status,
        addable: null,
        outfits: storedOutfits
          .filter((o) => o.requestId === requestId)
          .map((o) => ({
            id: o.id,
            caption: o.caption,
            occasion: o.occasion,
            why: o.why,
            missing: o.missing,
            pieces: o.pieces.map((p) => {
              const row = itemRows.find((r) => r.id === p.itemId);
              return { hero: p.hero, item: row ? toApiItem(row) : null };
            }),
            ...summarize(reactions.filter((r) => r.outfitId === o.id)),
          })),
      };
    },
    react: async (outfitId, userId, reaction) => {
      if (!storedOutfits.some((o) => o.id === outfitId && o.userId === userId)) return false;
      reactions.push({ outfitId, userId, reaction, createdAt: now() });
      return true;
    },
    reactionCount: async (userId) => reactions.filter((r) => r.userId === userId).length,
    reactedOutfits: async (userId, limit) =>
      [...new Set(reactions.filter((r) => r.userId === userId).map((r) => r.outfitId))]
        .slice(0, limit)
        .map((id) => {
          const o = storedOutfits.find((s) => s.id === id)!;
          const { opinion, woreCount } = summarize(reactions.filter((r) => r.outfitId === id));
          return { opinion, wore: woreCount > 0, description: o.caption };
        }),
    inspirationKeys: async (userId, limit) =>
      [...photoRows.values()]
        .filter((p) => p.ownerId === userId && p.kind === "want" && p.status === "ready")
        .slice(0, limit)
        .map((p) => p.key),
    isAttached: async (photoKey) => itemRows.some((row) => row.input.photoKey === photoKey),
    brief: async (userId) => briefs.get(userId) ?? null,
    setBriefBatch: async (userId, batchId) => {
      const current = briefs.get(userId) ?? {
        brief: null,
        itemCount: 0,
        reactionCount: 0,
        writtenAt: null,
        batchId: null,
        requestedAt: null,
      };
      briefs.set(userId, { ...current, batchId, requestedAt: batchId ? new Date() : null });
    },
    saveBrief: async (userId, brief, itemCount, reactionCount) => {
      briefs.set(userId, {
        brief,
        itemCount,
        reactionCount,
        writtenAt: new Date(),
        batchId: null,
        requestedAt: null,
      });
    },
  };

  return { itemsRepository, photosRepository, usageRepository, outfitsRepository };
}

type QueuedJob =
  | { name: "process" | "tag"; key: string; lang: AppLanguage }
  | { name: "cutout" | "embed"; key: string };

// Records queued jobs instead of sending them to Redis; runAll plays the worker's part,
// including the tag jobs that processing queues on the way.
export function createManualPhotoQueue() {
  const queued: QueuedJob[] = [];
  const photoQueue: PhotoQueue = {
    enqueueProcessing: async (key, lang) => {
      queued.push({ name: "process", key, lang });
    },
    enqueueTagging: async (key, lang) => {
      queued.push({ name: "tag", key, lang });
    },
    enqueueCutout: async (key) => {
      queued.push({ name: "cutout", key });
    },
    enqueueEmbedding: async (key) => {
      queued.push({ name: "embed", key });
    },
  };
  async function runAll(deps: PhotoJobDeps) {
    for (let job = queued.shift(); job; job = queued.shift()) {
      if (job.name === "process") await processUploadedPhoto(deps, job.key, job.lang);
      else if (job.name === "tag") await tagPhoto(deps, job.key, job.lang);
      else if (job.name === "cutout") await cutOutPhoto(deps, job.key);
      else await embedPhoto(deps, job.key);
    }
  }
  return { photoQueue, queued, runAll };
}

export const shirtTags: ItemTags = {
  recognized: true,
  name: "White linen shirt",
  category: "top",
  colors: ["white"],
  seasons: ["spring", "summer"],
  fit: "relaxed",
  length: "hip-length",
  fabric: "linen",
  style: "casual",
  brand: null,
  condition: "good",
};

// What the stub finds on a look photo: a top in the upper half, jeans in the lower.
export const lookItems: LookItem[] = [
  {
    ...withoutRecognized(shirtTags),
    name: "Pink mesh top",
    colors: ["pink"],
    box: { xMin: 0.25, yMin: 0.1, xMax: 0.75, yMax: 0.45 },
    noun: "mesh top",
  },
  {
    ...withoutRecognized(shirtTags),
    name: "Blue wide-leg jeans",
    category: "bottom",
    colors: ["blue"],
    fabric: "denim",
    box: { xMin: 0.2, yMin: 0.45, xMax: 0.8, yMax: 0.95 },
    noun: "wide-leg jeans",
  },
];

function withoutRecognized({ recognized: _recognized, ...tags }: ItemTags) {
  return tags;
}

// Stands in for Claude: answers with fixed tags (or look items) and records what it was asked.
export function createStubTagger(
  answer: () => Promise<ItemTags> = async () => shirtTags,
  look: () => Promise<LookItem[]> = async () => lookItems,
  {
    onPerson = false,
    verdict = async (): Promise<MatchVerdict> => ({ how: "same", index: 0 }),
  } = {},
) {
  const calls: { bytes: number; lang: AppLanguage; kind: "item" | "look" }[] = [];
  // The names of the wardrobe items each comparison was shown.
  const compared: string[][] = [];
  const tagger: ItemTagger = {
    tag: async (image, lang) => {
      calls.push({ bytes: image.length, lang, kind: "item" });
      return { ...(await answer()), onPerson };
    },
    findItems: async (image, lang) => {
      calls.push({ bytes: image.length, lang, kind: "look" });
      return look();
    },
    compare: async (_item, candidates) => {
      compared.push(candidates.map((candidate) => candidate.name));
      return verdict();
    },
  };
  return { tagger, calls, compared };
}

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

// A unit-length vector of the model's size whose first components are the given weights,
// so tests can place photos closer to or further from each other.
export function unitVector(...weights: number[]): number[] {
  const length = Math.hypot(...weights);
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (weights[i] ?? 0) / length);
}

// Stands in for the embedding model: answers with a fixed vector and records the calls.
export function createStubEmbedder(vector: number[] = unitVector(1)) {
  const calls: { bytes: number }[] = [];
  const embedder: ItemEmbedder = {
    embedImage: async (image) => {
      calls.push({ bytes: image.length });
      return vector;
    },
  };
  return { embedder, calls };
}

// Stands in for fal.ai: answers with a transparent PNG the size of the input, with an opaque
// square in the middle (the "item"), and records the calls. answer can make it fail, or find
// nothing (null), instead.
export function createStubRemover(answer?: () => Promise<Uint8Array | null>) {
  const calls: { bytes: number; name?: string }[] = [];
  const remover: BackgroundRemover = {
    removeBackground: async (image, name) => {
      calls.push({ bytes: image.length, ...(name ? { name } : {}) });
      if (answer) return answer();
      const { width = 100, height = 100 } = await sharp(image).metadata();
      const side = Math.round(Math.min(width, height) / 2);
      const item = await sharp({
        create: {
          width: side,
          height: side,
          channels: 4,
          background: { r: 200, g: 40, b: 40, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      return sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: item, gravity: "center" }])
        .png()
        .toBuffer();
    },
  };
  return { remover, calls };
}

// Records outfit jobs instead of sending them to Redis; runAll plays the worker. A brief check
// queued while running is run too, as if its delay had passed.
export function createManualOutfitQueue() {
  type Job =
    | { name: "compose"; requestId: string; lang: AppLanguage }
    | { name: "brief" | "brief-check"; userId: string };
  const queued: Job[] = [];
  const outfitQueue: OutfitQueue = {
    enqueueComposing: async (requestId, lang) =>
      void queued.push({ name: "compose", requestId, lang }),
    enqueueBrief: async (userId) => {
      // Deduped like the real queue's job id.
      if (!queued.some((j) => j.name === "brief" && j.userId === userId))
        queued.push({ name: "brief", userId });
    },
    enqueueBriefCheck: async (userId) => void queued.push({ name: "brief-check", userId }),
  };
  async function runAll(deps: OutfitJobDeps) {
    for (let job = queued.shift(); job; job = queued.shift()) {
      if (job.name === "compose") await composeOutfits(deps, job.requestId, job.lang);
      else if (job.name === "brief") await refreshBrief(deps, job.userId);
      else await checkBrief(deps, job.userId);
    }
  }
  return { outfitQueue, queued, runAll };
}

// Stands in for Claude: composes looks from the first pieces on offer, writes a fixed brief.
export function createStubStylist() {
  const composeCalls: ComposeInput[] = [];
  const briefCalls: BriefInput[] = [];
  const stylist: Stylist = {
    async compose(input) {
      composeCalls.push(input);
      const others = input.wardrobe.map((p) => p.n);
      return {
        looks: Array.from({ length: input.looks }, (_, i) => ({
          // A number the model made up (999) is dropped by the job.
          items: [others[i % others.length]!, 999].filter((n) => n !== undefined),
          missing:
            i === 0 ? { category: "shoes" as const, description: "black leather boots" } : null,
          caption: `Look ${i + 1}`,
          occasion: "coffee",
          why: "because",
        })),
        costMicros: 6_000,
      };
    },
    async submitBrief(input) {
      briefCalls.push(input);
      return `batch-${briefCalls.length}`;
    },
    async briefResult() {
      return { status: "done", brief: "High-low with a wink.", costMicros: 50_000 };
    },
  };
  return { stylist, composeCalls, briefCalls };
}
