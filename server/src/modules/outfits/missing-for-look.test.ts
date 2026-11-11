import { describe, expect, it } from "vitest";
import { incompleteMessage, missingForLook, missingOf } from "@closet-ai/shared";

describe("missingForLook", () => {
  it("a top needs a bottom, a bottom a top; a dress doesn't stand in for either", () => {
    expect(missingForLook("top", ["dress", "shoes"])).toEqual(["bottom"]);
    expect(missingForLook("top", ["bottom"])).toEqual([]);
    expect(missingForLook("bottom", ["dress"])).toEqual(["top"]);
    expect(missingForLook("bottom", ["top"])).toEqual([]);
  });

  it("a dress stands alone", () => {
    expect(missingForLook("dress", [])).toEqual([]);
  });

  it("a coat, shoes or a bag need a dress, or a top and a bottom", () => {
    expect(missingForLook("outerwear", ["dress"])).toEqual([]);
    expect(missingForLook("shoes", ["top", "bottom"])).toEqual([]);
    expect(missingForLook("accessory", ["top"])).toEqual(["bottom"]);
    expect(missingForLook("outerwear", [])).toEqual(["top", "bottom"]);
  });

  it("is said and read back the same way", () => {
    expect(missingOf(incompleteMessage(["top", "bottom"]))).toEqual(["top", "bottom"]);
    expect(missingOf("limit:wear_with")).toBeNull();
  });
});
