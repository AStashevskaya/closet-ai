import { describe, expect, it } from "vitest";
import { withoutNumbers } from "./outfit-jobs";

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
