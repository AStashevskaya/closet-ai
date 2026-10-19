import { describe, expect, it } from "vitest";
import { processJobId } from "../src/queue/photo-queue";

describe("processJobId", () => {
  it("is stable per photo and free of the colon BullMQ rejects", () => {
    const key = "photos/user:1/6b1f7c3e-0000-4000-8000-000000000001.webp";
    expect(processJobId(key)).toBe(processJobId(key));
    expect(processJobId(key)).not.toContain(":");
    expect(processJobId(key)).not.toBe(processJobId(key.replace("0001", "0002")));
  });
});
