import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../config/env";

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

// The app only needs these few operations, so tests swap in createMemoryStorage
// and never need SeaweedFS or R2.
export interface Storage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  // Deleting a key that doesn't exist is not an error (S3 behaves the same way).
  delete(key: string): Promise<void>;
  // Deletes every object whose key starts with the prefix (all of one user's photos).
  deletePrefix(prefix: string): Promise<void>;
}

function isMissing(error: unknown) {
  return error instanceof NoSuchKey || error instanceof NotFound;
}

export function createS3Storage(env: Env) {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // SeaweedFS serves buckets as paths (host/bucket/key), not subdomains; R2 accepts both.
    forcePathStyle: true,
  });
  const Bucket = env.S3_BUCKET;

  const storage: Storage = {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!res.Body) return null;
        return {
          body: await res.Body.transformToByteArray(),
          contentType: res.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    // Listed a page (up to 1000 keys) at a time, each page deleted in one request.
    async deletePrefix(prefix) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
        );
        const keys = (page.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));
        if (keys.length > 0) {
          await client.send(
            new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }),
          );
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    },
  };

  // Local SeaweedFS starts empty; in production the bucket is created once in the R2 dashboard.
  async function ensureBucket() {
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
    } catch (error) {
      if (!isMissing(error)) throw error;
      await client.send(new CreateBucketCommand({ Bucket }));
    }
  }

  return { storage, ensureBucket, close: () => client.destroy() };
}

export function createMemoryStorage(): Storage {
  const objects = new Map<string, StoredObject>();
  return {
    put: async (key, body, contentType) => {
      objects.set(key, { body, contentType });
    },
    get: async (key) => objects.get(key) ?? null,
    exists: async (key) => objects.has(key),
    delete: async (key) => {
      objects.delete(key);
    },
    deletePrefix: async (prefix) => {
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
    },
  };
}
