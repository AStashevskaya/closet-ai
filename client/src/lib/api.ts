import {
  type AppLanguage,
  type CreateItemInput,
  item,
  type Item,
  itemDetail,
  type ItemDetail,
  itemList,
  photoState,
  type PhotoState,
  type UpdateItemInput,
  uploadedPhoto,
} from '@closet-ai/shared';
import { File } from 'expo-file-system';

import { apiUrl } from './api-url';
import { authClient } from './auth-client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
  const res = await fetch(absoluteUrl(path), {
    ...init,
    headers: { ...(await sessionHeaders()), ...init.headers },
  });
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

// Saves the user's corrections; only the fields given change.
export function updateItem(id: string, patch: UpdateItemInput): Promise<ItemDetail> {
  return request(`/api/items/${id}`, itemDetail, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

// The server answers 204 with no body, so there is nothing to parse.
export async function deleteItem(id: string): Promise<void> {
  await send(`/api/items/${id}`, { method: 'DELETE' });
}

// Uploads a local JPEG (see shrinkPhoto) and returns the key to pass to createItem.
// lang is the language the server's suggested item name comes back in.
export async function uploadPhoto(uri: string, lang: AppLanguage): Promise<string> {
  const form = new FormData();
  // The global fetch is expo/fetch, which rejects React Native's { uri, name, type } parts
  // ("Unsupported FormDataPart implementation"). An expo-file-system File is a Blob it can read.
  form.append('photo', new File(uri));
  const { photoKey } = await request(`/api/photos?lang=${lang}`, uploadedPhoto, {
    method: 'POST',
    body: form,
  });
  return photoKey;
}

// Whether an uploaded photo is processed yet, and what the vision model read off it.
export function getPhotoState(photoKey: string): Promise<PhotoState> {
  return request(`/api/photos/status?key=${encodeURIComponent(photoKey)}`, photoState);
}
