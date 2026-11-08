import { describe, expect, it } from "vitest";
import { isLiked, withoutNumbers } from "./outfit-jobs";

describe("isLiked", () => {
  it("goes by her latest word on a look she wore", () => {
    expect(isLiked({ opinion: "like", wore: false })).toBe(true);
    expect(isLiked({ opinion: null, wore: true })).toBe(true);
    expect(isLiked({ opinion: "dislike", wore: true })).toBe(false);
    expect(isLiked({ opinion: null, wore: false })).toBe(false);
  });
});

describe("withoutNumbers", () => {
  it("drops piece numbers from a text she reads, keeping the names", () => {
    expect(
      withoutNumbers(
        "Белая вельветовая рубашка #55, накинутая на корсет, и стёганая сумка #56 добавляет мягкости.",
      ),
    ).toBe("Белая вельветовая рубашка, накинутая на корсет, и стёганая сумка добавляет мягкости.");
    expect(withoutNumbers("Your grey tank (#32) under the blazer.")).toBe(
      "Your grey tank under the blazer.",
    );
    expect(withoutNumbers("Pink over grey")).toBe("Pink over grey");
  });
});
