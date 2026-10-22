import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env";

const base = {
  DATABASE_URL: "postgres://closet:closet@localhost:5432/closet",
  BETTER_AUTH_SECRET: "a-real-secret-that-is-at-least-32-characters",
  S3_ENDPOINT: "http://localhost:8333",
  S3_BUCKET: "closet-photos",
  S3_ACCESS_KEY_ID: "closet",
  S3_SECRET_ACCESS_KEY: "closet-dev-secret",
};

function errorsFor(source: Record<string, string>) {
  const parsed = parseEnv(source);
  return parsed.success ? {} : parsed.error.flatten().fieldErrors;
}

describe("parseEnv", () => {
  it("accepts a development setup and defaults the auth URL to localhost", () => {
    const parsed = parseEnv(base);
    expect(parsed.success && parsed.data.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });

  it("runs the workers inside the API unless told otherwise", () => {
    const inline = parseEnv(base);
    const apart = parseEnv({ ...base, WORKERS_IN_API: "false" });
    expect(inline.success && inline.data.WORKERS_IN_API).toBe(true);
    expect(apart.success && apart.data.WORKERS_IN_API).toBe(false);
  });

  it("rejects the example secret from .env.example", () => {
    const errors = errorsFor({
      ...base,
      BETTER_AUTH_SECRET: "change-me-to-a-random-string-of-32-chars-or-more",
    });
    expect(errors.BETTER_AUTH_SECRET).toBeDefined();
  });

  it("requires an https auth URL in production", () => {
    expect(errorsFor({ ...base, NODE_ENV: "production" }).BETTER_AUTH_URL).toBeDefined();
    expect(
      errorsFor({ ...base, NODE_ENV: "production", BETTER_AUTH_URL: "http://api.example.com" })
        .BETTER_AUTH_URL,
    ).toBeDefined();
    expect(
      parseEnv({ ...base, NODE_ENV: "production", BETTER_AUTH_URL: "https://api.example.com" })
        .success,
    ).toBe(true);
  });
});
