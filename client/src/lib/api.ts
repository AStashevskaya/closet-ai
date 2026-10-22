import {
  type AddLookItemsInput,
  type AppLanguage,
  type CreateItemInput,
  item,
  type Item,
  itemDetail,
  type ItemDetail,
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
  type OutfitReaction,
  wearWithRequest,
  type WearWithRequest,
  catalogItem,
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
} from '@closet-ai/shared';
import { File } from 'expo-file-system';

import { ApiError, OfflineError } from './api-error';
import { apiUrl } from './api-url';
import { authClient } from './auth-client';

export { ApiError, OfflineError };

// The session cookie from SecureStore. Native fetch has no cookie jar, so every call
// (and every photo the app loads) sends it explicitly.
export async function sessionHeaders(): Promise<Record<string, string>> {
  const cookie = await authClient.getCookie();
  return cookie ? { cookie } : {};
}

// Paths from the API (such as an item's photoUrl) are relative to the server.
export const absoluteUrl = (path: string) => `${apiUrl()}${path}`;

// Sends the request with the session cookie and turns a non-2xx status into an ApiError.
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(await sessionHeaders()), ...init.headers };
  let res: Response;
  try {
    res = await fetch(absoluteUrl(path), { ...init, headers });
  } catch (cause) {
    // fetch only rejects when no answer came back at all.
    throw new OfflineError(cause instanceof Error ? cause.message : 'unreachable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? res.statusText);
  }
  return res;
}

// Responses are parsed with the shared Zod schemas, so a server/app mismatch fails loudly here.
async function request<T>(
  path: string,
  schema: { parse(data: unknown): T },
  init: RequestInit = {},
): Promise<T> {
  const res = await send(path, init);
  return schema.parse(await res.json());
}

export function listItems(): Promise<Item[]> {
  return request('/api/items', itemList);
}

export function createItem(input: CreateItemInput): Promise<Item> {
  return request('/api/items', item, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
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
  return request(`/api/items/${id}`, itemDetail, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// How much of the free tier is used: the wardrobe size and this month's screenshots and selfies.
export function getUsage(): Promise<Usage> {
  return request('/api/usage', usage);
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

// Partner pieces in the outfits come named in the language asked for.
export function getWearWith(id: string, lang: AppLanguage): Promise<WearWithRequest> {
  return request(`/api/wear-with/${id}?lang=${lang}`, wearWithRequest);
}

export function getCatalogItem(id: string, lang: AppLanguage): Promise<CatalogItem> {
  return request(`/api/catalog/${id}?lang=${lang}`, catalogItem);
}

export async function reactToOutfit(id: string, reaction: OutfitReaction): Promise<void> {
  await send(`/api/outfits/${id}/reactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reaction }),
  });
}

// The looks saved on the Inspiration tab, newest first.
export function listInspiration(): Promise<Inspiration[]> {
  return request('/api/inspiration', inspirationList);
}

export async function deleteInspiration(key: string): Promise<void> {
  await send(`/api/inspiration?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
}

// Turns the item's photo (and its cut-out) a quarter clockwise; the photo URLs change.
export function rotateItem(id: string): Promise<ItemDetail> {
  return request(`/api/items/${id}/rotate`, itemDetail, { method: 'POST' });
}

// The server answers 204 with no body, so there is nothing to parse.
export async function deleteItem(id: string): Promise<void> {
  await send(`/api/items/${id}`, { method: 'DELETE' });
}

// Uploads a local JPEG (see shrinkPhoto) and returns the key to pass to createItem.
// lang is the language the server's suggested item name comes back in; a "look" photo is an
// outfit to pick items from (see addLookItems).
export async function uploadPhoto(
  uri: string,
  lang: AppLanguage,
  kind: PhotoKind = 'item',
): Promise<string> {
  const form = new FormData();
  // The global fetch is expo/fetch, which rejects React Native's { uri, name, type } parts
  // ("Unsupported FormDataPart implementation"). An expo-file-system File is a Blob it can read.
  form.append('photo', new File(uri));
  const { photoKey } = await request(`/api/photos?lang=${lang}&kind=${kind}`, uploadedPhoto, {
    method: 'POST',
    body: form,
  });
  return photoKey;
}

// Whether an uploaded photo is processed yet, and what the vision model read off it.
export function getPhotoState(photoKey: string): Promise<PhotoState> {
  return request(`/api/photos/status?key=${encodeURIComponent(photoKey)}`, photoState);
}

// Adds the items picked from a look photo to the wardrobe; each gets the look cropped to it.
export function addLookItems(input: AddLookItemsInput): Promise<Item[]> {
  return request('/api/photos/look-items', itemList, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
