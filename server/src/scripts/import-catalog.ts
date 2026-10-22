// Imports a brand feed into the partner catalog: stores each picture, embeds it with the same
// model as wardrobe photos and adds or updates the item by its feed id. Safe to run again.
// Usage: pnpm --filter @closet-ai/server catalog:import [feed folder]
// The folder holds feed.json and the pictures it names; the default is the demo catalog in
// seed/catalog (100 items of the made-up brand STUDIO EDIT, from the owner's sheet).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APP_LANGUAGES, currency, itemCategory, itemColor } from "@closet-ai/shared";
import { z } from "zod";
import { createFashionSiglipEmbedder } from "../ai/item-embedder";
import { loadEnv } from "../config/env";
import { createDb } from "../db/client";
import { createCatalogRepository } from "../modules/catalog/catalog.repository";
import { toMinor } from "../modules/items/items.repository";
import { flattenOnWhite, processCutout } from "../modules/photos/process-photo";
import { createS3Storage } from "../storage/storage";

const feed = z.array(
  z.object({
    externalId: z.string().regex(/^[\w-]{1,40}$/),
    brand: z.string().min(1),
    names: z.record(z.enum(APP_LANGUAGES), z.string().min(1)),
    category: itemCategory,
    colors: z.array(itemColor).min(1),
    price: z.number().nonnegative(),
    currency,
    url: z.string().url(),
    inStock: z.boolean(),
    // Relative to the feed folder; any format sharp reads, ideally with a transparent background.
    image: z.string(),
    // A made-up brand: the app doesn't offer its link.
    demo: z.boolean().default(false),
  }),
);

const folder = path.resolve(process.argv[2] ?? "seed/catalog");
const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const s3 = createS3Storage(env);
if (env.NODE_ENV === "development") await s3.ensureBucket();
const catalog = createCatalogRepository(db);
const embedder = createFashionSiglipEmbedder(env.MODEL_CACHE_DIR);

const items = feed.parse(JSON.parse(await readFile(path.join(folder, "feed.json"), "utf8")));
for (const { image, price, ...item } of items) {
  const picture = await processCutout(await readFile(path.join(folder, image)));
  const imageKey = `catalog/${item.externalId}.webp`;
  await s3.storage.put(imageKey, picture, "image/webp");
  await catalog.upsert({
    ...item,
    priceMinor: toMinor(price)!,
    imageKey,
    embedding: await embedder.embedImage(await flattenOnWhite(picture)),
  });
}
console.log(`Imported ${items.length} catalog item(s) from ${folder}.`);

await close();
s3.close();
