import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createAuth } from "../src/auth/auth";
import { deleteUserFiles } from "../src/modules/account/account";
import { createMemoryStorage } from "../src/storage/storage";
import {
  createInMemoryRepositories,
  createManualOutfitQueue,
  createManualPhotoQueue,
  testEnv as env,
} from "./helpers";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;

afterEach(async () => {
  await app?.close();
});

const PASSWORD = "correct-horse-battery";
const silent = { error: () => {} };

async function setup() {
  const storage = createMemoryStorage();
  const auth = createAuth(
    env,
    memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    { onUserDeleted: deleteUserFiles(storage, silent) },
  );
  app = await buildApp({
    env,
    auth,
    ...createInMemoryRepositories(),
    photoQueue: createManualPhotoQueue().photoQueue,
    outfitQueue: createManualOutfitQueue().outfitQueue,
    storage,
    taggingEnabled: true,
    stylistEnabled: true,
  });
  return { server: app, storage };
}

async function signUp(server: App, email: string) {
  const res = await server.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: "Test User", email, password: PASSWORD },
  });
  const cookie = res.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const session = await server.inject({
    method: "GET",
    url: "/api/auth/get-session",
    headers: { cookie },
  });
  return { cookie, userId: session.json<{ user: { id: string } }>().user.id };
}

const deleteAccount = (server: App, cookie: string, password: string) =>
  server.inject({
    method: "POST",
    url: "/api/auth/delete-user",
    headers: { cookie, origin: "closetai://" },
    payload: { password },
  });

describe("deleting the account", () => {
  it("removes the user and every file of theirs, and nobody else's", async () => {
    const { server, storage } = await setup();
    const anna = await signUp(server, "anna@example.com");
    const boris = await signUp(server, "boris@example.com");
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put(`photos/${anna.userId}/a.webp`, bytes, "image/webp");
    await storage.put(`photos/${anna.userId}/a-cutout.webp`, bytes, "image/webp");
    await storage.put(`uploads/${anna.userId}/raw`, bytes, "image/jpeg");
    await storage.put(`photos/${boris.userId}/b.webp`, bytes, "image/webp");

    expect((await deleteAccount(server, anna.cookie, PASSWORD)).statusCode).toBe(200);

    expect(await storage.exists(`photos/${anna.userId}/a.webp`)).toBe(false);
    expect(await storage.exists(`photos/${anna.userId}/a-cutout.webp`)).toBe(false);
    expect(await storage.exists(`uploads/${anna.userId}/raw`)).toBe(false);
    expect(await storage.exists(`photos/${boris.userId}/b.webp`)).toBe(true);
    // Signed out and gone: the old session no longer works, and the password no longer signs in.
    const items = await server.inject({
      method: "GET",
      url: "/api/items",
      headers: { cookie: anna.cookie },
    });
    expect(items.statusCode).toBe(401);
    const signIn = await server.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      payload: { email: "anna@example.com", password: PASSWORD },
    });
    expect(signIn.statusCode).toBe(401);
  });

  it("asks for the right password first", async () => {
    const { server, storage } = await setup();
    const anna = await signUp(server, "anna@example.com");
    await storage.put(`photos/${anna.userId}/a.webp`, new Uint8Array([1]), "image/webp");

    expect((await deleteAccount(server, anna.cookie, "wrong-password")).statusCode).toBe(400);
    expect(await storage.exists(`photos/${anna.userId}/a.webp`)).toBe(true);
  });
});
