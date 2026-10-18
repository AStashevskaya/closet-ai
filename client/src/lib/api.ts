import { type CreateItemInput, item, type Item, itemList, uploadedPhoto } from '@closet-ai/shared';
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

// Responses are parsed with the shared Zod schemas, so a server/app mismatch fails loudly here.
async function request<T>(
  path: string,
  schema: { parse(data: unknown): T },
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(absoluteUrl(path), {
    ...init,
    headers: { ...(await sessionHeaders()), ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(res.status, body?.message ?? res.statusText);
  }
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

// Uploads a local JPEG (see shrinkPhoto) and returns the key to pass to createItem.
export async function uploadPhoto(uri: string): Promise<string> {
  const form = new FormData();
  // The global fetch is expo/fetch, which rejects React Native's { uri, name, type } parts
  // ("Unsupported FormDataPart implementation"). An expo-file-system File is a Blob it can read.
  form.append('photo', new File(uri));
  const { photoKey } = await request('/api/photos', uploadedPhoto, { method: 'POST', body: form });
  return photoKey;
}
