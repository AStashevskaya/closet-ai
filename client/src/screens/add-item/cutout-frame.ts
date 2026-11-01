import { CUTOUT_PADDING, type ItemBox } from '@closet-ai/shared';

export type Size = { width: number; height: number };
// A rectangle inside the frame, from its top-left corner (photo pixels aren't mirrored in RTL).
export type Frame = { left: number; top: number; width: number; height: number };

// Where to draw the stored cut-out inside a frame that shows its photo with contentFit
// "contain", so the piece in the cut-out lies exactly over the piece in the photo.
// The photo is scaled to fit and centred; the piece is `box` of it (0..1 of the photo, without
// padding); the stored cut-out is the piece plus CUTOUT_PADDING of the piece's longer side on
// every side (shared/src/index.ts), so the layer is that much larger all round. Being a share of
// the piece's own size, the padding scales with the photo and is the same in frame points.
// Null when the photo's size or the box gives nothing to draw (the print then falls back to
// drawing the cut-out over the whole frame).
export function cutoutFrame(frame: Size, photo: Size, box: ItemBox): Frame | null {
  if (photo.width <= 0 || photo.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(frame.width / photo.width, frame.height / photo.height);
  const shown = { width: photo.width * scale, height: photo.height * scale };
  // "contain" centres the photo: bands at the sides of a tall photo, above and below a wide one.
  const offsetX = (frame.width - shown.width) / 2;
  const offsetY = (frame.height - shown.height) / 2;
  const pieceWidth = (box.xMax - box.xMin) * shown.width;
  const pieceHeight = (box.yMax - box.yMin) * shown.height;
  if (pieceWidth <= 0 || pieceHeight <= 0) return null;
  const pad = Math.max(pieceWidth, pieceHeight) * CUTOUT_PADDING;
  return {
    left: offsetX + box.xMin * shown.width - pad,
    top: offsetY + box.yMin * shown.height - pad,
    width: pieceWidth + pad * 2,
    height: pieceHeight + pad * 2,
  };
}
