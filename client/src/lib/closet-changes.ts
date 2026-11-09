// Tells whoever keeps a copy of her closet that a piece was added, changed or deleted. On its own so
// that `api.ts`, which says it, and `closet-pieces.ts`, which reads through `api.ts`, don't import
// each other.
const listeners = new Set<() => void>();

export function closetChanged() {
  listeners.forEach((listener) => listener());
}

export function onClosetChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
