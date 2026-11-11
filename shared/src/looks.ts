import type { ItemCategory } from "./index";

// What a closet lacks for a look around a piece of this kind, or nothing when it can make one
// (decided 2026-11-11: a look without a bottom or a dress is never shown). A top needs a bottom
// and a bottom a top: a dress doesn't go with either (outfit-jobs, "heroWithDress"). A dress
// stands alone. A coat, shoes or a bag need a dress, or a top and a bottom.
// Later the missing kind may come from brands (owner, 2026-11-11), not yet.
export function missingForLook(
  hero: ItemCategory,
  closet: readonly ItemCategory[],
): ("top" | "bottom")[] {
  const has = (kind: ItemCategory) => closet.includes(kind);
  if (hero === "dress") return [];
  if (hero === "top") return has("bottom") ? [] : ["bottom"];
  if (hero === "bottom") return has("top") ? [] : ["top"];
  if (has("dress")) return [];
  return (["top", "bottom"] as const).filter((kind) => !has(kind));
}

// Whether a look around a piece of this kind is whole: the same rule, over the look's own pieces.
export const isWholeLook = (hero: ItemCategory, pieces: readonly ItemCategory[]) =>
  missingForLook(hero, pieces).length === 0;

// How the server says so (422), and how the app reads it back.
export const INCOMPLETE_PREFIX = "incomplete:";
export const incompleteMessage = (missing: readonly ("top" | "bottom")[]) =>
  `${INCOMPLETE_PREFIX}${missing.join(",")}`;
export function missingOf(message: string): ("top" | "bottom")[] | null {
  if (!message.startsWith(INCOMPLETE_PREFIX)) return null;
  return message
    .slice(INCOMPLETE_PREFIX.length)
    .split(",")
    .filter((kind): kind is "top" | "bottom" => kind === "top" || kind === "bottom");
}
