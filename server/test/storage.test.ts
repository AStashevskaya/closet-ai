import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createS3Storage } from "../src/storage/storage";
import { testEnv } from "./helpers";

// The S3 storage against a real S3 API: SeaweedFS from docker-compose locally, a SeaweedFS
// container in CI. Runs only when TEST_S3_ENDPOINT is set; credentials are the development
// ones from docker/seaweedfs/s3.json.
const endpoint = process.env.TEST_S3_ENDPOINT;

if (!endpoint && process.env.CI) {
  it("has TEST_S3_ENDPOINT in CI", () => {
    throw new Error("TEST_S3_ENDPOINT is not set; the storage tests would be skipped");
  });
}

describe.skipIf(!endpoint)("S3 storage", () => {
  const s3 = createS3Storage({
    ...testEnv,
    S3_ENDPOINT: endpoint ?? "http://localhost:8333",
    S3_BUCKET: "closet-photos-test",
    S3_ACCESS_KEY_ID: "closet",
    S3_SECRET_ACCESS_KEY: "closet-dev-secret",
  });

  beforeAll(() => s3.ensureBucket());
  afterAll(() => s3.close());

  it("stores an object and reads it back", async () => {
    const key = `test/${randomUUID()}.webp`;
    const body = new TextEncoder().encode("photo bytes");

    await s3.storage.put(key, body, "image/webp");

    expect(await s3.storage.exists(key)).toBe(true);
    const stored = await s3.storage.get(key);
    expect(stored?.contentType).toBe("image/webp");
    expect(new TextDecoder().decode(stored?.body)).toBe("photo bytes");
  });

  it("reports a missing object", async () => {
    const key = `test/${randomUUID()}.webp`;
    expect(await s3.storage.exists(key)).toBe(false);
    expect(await s3.storage.get(key)).toBeNull();
  });

  it("creating the bucket twice is harmless", async () => {
    await expect(s3.ensureBucket()).resolves.toBeUndefined();
  });
});
