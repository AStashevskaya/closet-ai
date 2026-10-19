import { randomUUID } from "node:crypto";
import type { AddLookItemsInput, Item } from "@closet-ai/shared";
import type { Storage } from "../../storage/storage";
import type { ItemsRepository } from "../items/items.repository";
import type { PhotoQueue } from "../../queue/photo-queue";
import { cropToBox } from "./process-photo";
import type { PhotosRepository } from "./photos.repository";
import { photoPrefix } from "./photos.routes";

export interface LookItemsDeps {
  photos: PhotosRepository;
  items: ItemsRepository;
  storage: Storage;
  queue: Pick<PhotoQueue, "enqueueEmbedding">;
}

// Why a request can't be served; the route turns these into 4xx.
export type LookItemsError = "not-found" | "not-ready" | "bad-index";

// Adds the items the user picked from a look photo to their wardrobe. Each gets its own photo,
// the look cropped to the item's box, tagged with what the model read off the look, and is
// queued for its embedding. No cut-out: the crop shows the person wearing the item, and
// removing the background around a body leaves an odd shape. The look photo itself stays
// unattached, so the cleanup job removes it after a day.
export async function addItemsFromLook(
  { photos, items, storage, queue }: LookItemsDeps,
  ownerId: string,
  input: AddLookItemsInput,
): Promise<Item[] | LookItemsError> {
  const look = await photos.get(input.photoKey);
  if (!look || look.ownerId !== ownerId || look.kind !== "look") return "not-found";
  if (look.status !== "ready" || !look.lookItems) return "not-ready";
  const found = look.lookItems;
  if (input.items.some(({ index }) => index >= found.length)) return "bad-index";

  const file = await storage.get(look.key);
  if (!file) return "not-found";

  const created: Item[] = [];
  for (const picked of input.items) {
    const { box: _box, ...tags } = found[picked.index]!;
    const { index: _index, ...fields } = picked;
    const key = `${photoPrefix(ownerId)}${randomUUID()}.webp`;
    await storage.put(key, await cropToBox(file.body, found[picked.index]!.box), "image/webp");
    // The user's corrections win over what the model read.
    await photos.createReady({ key, ownerId, tags: { ...tags, ...fields, recognized: true } });
    created.push(await items.create(ownerId, { ...fields, photoKey: key }));
    await queue.enqueueEmbedding(key);
  }
  return created;
}
