import {
  type AddLookItemsInput,
  type AppLanguage,
  type CreateItemInput,
  item,
  type Item,
  itemDetail,
  type ItemDetail,
  type LimitCode,
  itemList,
  type PhotoKind,
  photoState,
  type PhotoState,
  type SimilarItem,
  similarItems,
  type UpdateItemInput,
  uploadedPhoto,
  usage,
  type Usage,
  type DislikeReason,
  type OutfitReaction,
  wearWithRequest,
  type WearWithRequest,
  catalogItem,
  catalogList,
  wish,
  wishList,
  wishesDue,
  type Wish,
  type WishAnswer,
  type CatalogFeedItem,
  type CatalogItem,
  wearWithStarted,
  type WearWithInput,
  inspirationList,
  type Inspiration,
  type UpdateProfileInput,
  userProfile,
  type UserProfile,
  styledList,
  type StyledEntry,
  styleState,
  type StyleState,
} from '@closet-ai/shared';
import { File } from 'expo-file-system';

import { ApiError, OfflineError } from './api-error';
import { apiUrl } from './api-url';
import { authClient } from './auth-client';
import { closetChanged } from './closet-changes';

export { ApiError, OfflineError };

// The session cookie from SecureStore. Native fetch has no cookie jar, so every call
// (and every photo the app loads) sends it explicitly.
export async function sessionHeaders(): Promise<Record<string, string>> {
  const cookie = await authClient.getCookie();
  return cookie ? { cookie } : {};
}

// Paths from the API (such as an item's photoUrl) are relative to the server.
export const absoluteUrl = (path: string) => `${apiUrl()}${path}`;

// How long a request may go unanswered before it counts as no connection, so a screen waiting for
// it can say so and offer a retry instead of waiting forever. A check in a polling loop is the
// shortest: the loop asks again anyway, and counts on a check ending soon to give up in time. Heavy
// work gets the longest: on a slow network an upload takes a while, and so does the server's work
// with photos in storage.
export const POLL_TIMEOUT_MS = 10_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const HEAVY_TIMEOUT_MS = 120_000;

// Sends the request with the session cookie, turns a non-2xx status into an ApiError and hands the
// answer to `read`. The time limit covers reading the body too. An AbortController with a timer,
// not AbortSignal.timeout, which React Native doesn't guarantee; its signal replaces any in `init`.
async function exchange<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { ...(await sessionHeaders()), ...init.headers };
    let res: Response;
    try {
      res = await fetch(absoluteUrl(path), { ...init, headers, signal: controller.signal });
    } catch (cause) {
      // fetch only rejects when no answer came back at all.
      throw new OfflineError(cause instanceof Error ? cause.message : 'unreachable');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(res.status, body?.message ?? res.statusText);
    }
    return await read(res);
  } catch (cause) {
    // Cut off while reading the body: the same as no answer. A refusal the server did send stays
    // one, or a used-up limit would read as no connection.
    if (
      controller.signal.aborted &&
      !(cause instanceof OfflineError) &&
      !(cause instanceof ApiError)
    ) {
      throw new OfflineError('timed out');
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

// For a call whose answer has nothing to read.
async function send(path: string, init: RequestInit = {}): Promise<void> {
  await exchange(path, init, REQUEST_TIMEOUT_MS, async () => undefined);
}

// Responses are parsed with the shared Zod schemas, so a server/app mismatch fails loudly here.
function request<T>(
  path: string,
  schema: { parse(data: unknown): T },
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return exchange(path, init, timeoutMs, async (res) => schema.parse(await res.json()));
}

// A call that changes her closet: anyone keeping a copy hears of it once the answer is in, or the
// lack of one, since a request that timed out may still have gone through.
function changingCloset<T>(call: Promise<T>): Promise<T> {
  return call.finally(closetChanged);
}

export function listItems(): Promise<Item[]> {
  return request('/api/items', itemList);
}

export function createItem(input: CreateItemInput): Promise<Item> {
  return changingCloset(
    request('/api/items', item, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

// The item with what the vision model read off its photo, for the item screen.
export function getItem(id: string): Promise<ItemDetail> {
  return request(`/api/items/${id}`, itemDetail);
}

// The closest items of the same category, for "similar in your wardrobe".
export function getSimilarItems(id: string): Promise<SimilarItem[]> {
  return request(`/api/items/${id}/similar`, similarItems);
}

// Saves the user's corrections; only the fields given change.
export function updateItem(id: string, patch: UpdateItemInput): Promise<ItemDetail> {
  return changingCloset(
    request(`/api/items/${id}`, itemDetail, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  );
}

// How much of the free tier is used: the wardrobe size and this month's screenshots and selfies.
export function getUsage(): Promise<Usage> {
  return request('/api/usage', usage);
}

// Her style summary, and whether the "great shopping" card should offer an update.
export function getStyle(lang: AppLanguage): Promise<StyleState> {
  return request(`/api/style?lang=${lang}`, styleState);
}

// She tapped "I want more" on a reached limit.
export function wantMore(code: LimitCode): Promise<void> {
  return send('/api/usage/want-more', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export function refreshStyle(lang: AppLanguage): Promise<StyleState> {
  return request(`/api/style/refresh?lang=${lang}`, styleState, { method: 'POST' });
}

// "What do I wear this with?" for a wardrobe item, or an item found on an uploaded "wear" photo:
// the request to poll (for a wardrobe item, an earlier one, done already, when the closet
// hasn't changed since).
export function askWearWith(input: WearWithInput, lang: AppLanguage): Promise<{ id: string }> {
  return request(`/api/wear-with?lang=${lang}`, wearWithStarted, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

// The user's details (Profile → My details); every field null until filled in.
export function getProfile(): Promise<UserProfile> {
  return request('/api/profile', userProfile);
}

export function updateProfile(patch: UpdateProfileInput): Promise<UserProfile> {
  return request('/api/profile', userProfile, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// The styled items, newest first, for the Style it tab.
export function listStyled(): Promise<StyledEntry[]> {
  return request('/api/wear-with', styledList);
}

// Wishes: pieces from photos the user wants to buy.
export function listWishes(): Promise<Wish[]> {
  return request('/api/wishes', wishList);
}

// How many wishes wait for "still want it?": the menu row's number.
export async function countDueWishes(): Promise<number> {
  return (await request('/api/wishes/due', wishesDue)).count;
}

export function addWish(requestId: string): Promise<Wish> {
  return request('/api/wishes', wish, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
}

export async function answerWish(id: string, answer: WishAnswer): Promise<void> {
  await send(`/api/wishes/${id}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
}

// Partner pieces in the outfits come named in the language asked for.
export function getWearWith(id: string, lang: AppLanguage): Promise<WearWithRequest> {
  return request(`/api/wear-with/${id}?lang=${lang}`, wearWithRequest, {}, POLL_TIMEOUT_MS);
}

// The Edit: partner pieces closest to the user's closet first.
export function listCatalog(lang: AppLanguage): Promise<CatalogFeedItem[]> {
  return request(`/api/catalog?lang=${lang}`, catalogList);
}

export function getCatalogItem(id: string, lang: AppLanguage): Promise<CatalogItem> {
  return request(`/api/catalog/${id}?lang=${lang}`, catalogItem);
}

// A dislike can say why: one of DISLIKE_REASONS, sent a tap after "Not mine".
export async function reactToOutfit(
  id: string,
  reaction: OutfitReaction,
  reason?: DislikeReason,
): Promise<void> {
  await send(`/api/outfits/${id}/reactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason ? { reaction, reason } : { reaction }),
  });
}

// The looks saved on Inspiration, newest first.
export function listInspiration(): Promise<Inspiration[]> {
  return request('/api/inspiration', inspirationList);
}

export async function deleteInspiration(key: string): Promise<void> {
  await send(`/api/inspiration?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// Deletes a styling for good. It doesn't give its try back.
export async function deleteWearWith(id: string): Promise<void> {
  await send(`/api/wear-with/${id}`, { method: 'DELETE' });
}

// Turns the item's photo (and its cut-out) a quarter clockwise; the photo URLs change.
// `photoUrl` is the photo she's looking at: the server turns only that one, so a retry after an
// answer that never came doesn't turn it twice.
export function rotateItem(id: string, photoUrl?: string): Promise<ItemDetail> {
  const version = photoUrl?.match(/[?&]v=([^&]+)/)?.[1];
  const query = version ? `?v=${version}` : '';
  return changingCloset(
    request(`/api/items/${id}/rotate${query}`, itemDetail, { method: 'POST' }, HEAVY_TIMEOUT_MS),
  );
}

// The server answers 204 with no body, so there is nothing to parse.
export async function deleteItem(id: string): Promise<void> {
  await changingCloset(send(`/api/items/${id}`, { method: 'DELETE' }));
}

const uploadAttempts = new Map<string, string>();
const newUploadAttempt = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Uploads a local JPEG (see shrinkPhoto) and returns the key to pass to createItem.
// lang is the language the server's suggested item name comes back in; a "look" photo is an
// outfit to pick items from (see addLookItems).
export async function uploadPhoto(
  uri: string,
  lang: AppLanguage,
  kind: PhotoKind = 'item',
): Promise<string> {
  // The same name for the same file until it has gone through: if the answer never came, the server
  // recognises the retry, and doesn't count or store the photo twice.
  const attempt = uploadAttempts.get(uri) ?? newUploadAttempt();
  uploadAttempts.set(uri, attempt);
  const form = new FormData();
  // The global fetch is expo/fetch, which rejects React Native's { uri, name, type } parts
  // ("Unsupported FormDataPart implementation"). An expo-file-system File is a Blob it can read.
  form.append('photo', new File(uri));
  try {
    const { photoKey } = await request(
      `/api/photos?lang=${lang}&kind=${kind}&attempt=${attempt}`,
      uploadedPhoto,
      { method: 'POST', body: form },
      HEAVY_TIMEOUT_MS,
    );
    uploadAttempts.delete(uri);
    return photoKey;
  } catch (cause) {
    // Refused: the server has no such photo, so nothing is left to recognise.
    if (cause instanceof ApiError) uploadAttempts.delete(uri);
    throw cause;
  }
}

// Whether an uploaded photo is processed yet, and what the vision model read off it.
// lang names a "want" look's partner pieces.
export function getPhotoState(photoKey: string, lang?: AppLanguage): Promise<PhotoState> {
  const query = `key=${encodeURIComponent(photoKey)}${lang ? `&lang=${lang}` : ''}`;
  return request(`/api/photos/status?${query}`, photoState, {}, POLL_TIMEOUT_MS);
}

// Adds the items picked from a look photo to the wardrobe; each gets the look cropped to it.
export function addLookItems(input: AddLookItemsInput): Promise<Item[]> {
  return changingCloset(
    request(
      '/api/photos/look-items',
      itemList,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
      // The server crops and stores each piece in turn.
      HEAVY_TIMEOUT_MS,
    ),
  );
}
