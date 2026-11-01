import { CUTOUT_PADDING, type ItemBox } from "@closet-ai/shared";
import sharp from "sharp";

// Sharp enough for a full-screen photo on a phone and for cropping into it (1024 px at quality
// 70 looked soft, 2026-10-21). Capped by area, not by the long side: a tall phone screenshot
// (1170 × 2532) kept to a 1600 px long side was only 739 px wide, soft on a full-width cover.
// About 2.6 MP: 1860 × 1395 for a 4:3 photo, 1100 × 2380 for a screenshot; ~300 KB.
export const PHOTO_MAX_PIXELS = 2_600_000;
const PHOTO_MAX_SIDE = 2600;
const WEBP_QUALITY = 85;
// Vision models get a smaller copy: they read items as well at 1024 px, for fewer tokens.
const MODEL_MAX_SIDE = 1024;
// Refuse absurd resolutions before decoding them (a 100 MB "image" can be a few KB of PNG).
const MAX_INPUT_PIXELS = 50_000_000;
// HEIC is not here: sharp's prebuilt binaries can't decode it, so the app converts to JPEG first.
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class UnsupportedPhotoError extends Error {}

const CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// Reads only the header, so the upload request can turn away a non-image at once
// instead of leaving it to fail in the worker. Returns the content type to store it with.
export async function checkPhoto(input: Uint8Array): Promise<string> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata());
  } catch {
    throw new UnsupportedPhotoError("not an image");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new UnsupportedPhotoError(`unsupported format: ${format ?? "unknown"}`);
  }
  return CONTENT_TYPES[format] ?? "application/octet-stream";
}

// Re-encodes an uploaded photo as a small WebP. The output carries no metadata,
// so EXIF data such as GPS location and camera model never reaches storage.
export async function processPhoto(input: Uint8Array): Promise<Uint8Array> {
  await checkPhoto(input);
  const {
    width = 1,
    height = 1,
    orientation = 1,
  } = await sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  // EXIF orientations 5 to 8 turn the photo a quarter, swapping its sides.
  const uprightWidth = orientation >= 5 ? height : width;
  const scale = Math.min(
    1,
    Math.sqrt(PHOTO_MAX_PIXELS / (width * height)),
    PHOTO_MAX_SIDE / Math.max(width, height),
  );

  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // apply the EXIF orientation before the EXIF data is dropped
    .resize({ width: Math.round(uprightWidth * scale), withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer();
}

// A stored photo as sent to a vision model: at most MODEL_MAX_SIDE on the long side.
export async function modelCopy(image: Uint8Array): Promise<Uint8Array> {
  return sharp(image)
    .resize({
      width: MODEL_MAX_SIDE,
      height: MODEL_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// The stored cut-out, and where the piece sits in the photo it was cut out of (0..1, the
// opaque pixels without the padding), so the app can lay it exactly over the piece.
export interface Cutout {
  webp: Uint8Array;
  box: ItemBox;
}

// Turns the background remover's PNG into the stored cut-out: the empty margins trimmed, a
// little even padding added back, WebP with transparency.
// The PNG covers the whole photo, but not necessarily at the photo's size (a remover may work
// on a smaller copy), so the box is measured against the PNG's own sides: a share of its
// width is the same share of the photo's.
export async function processCutout(png: Uint8Array): Promise<Cutout> {
  const { width: fullWidth = 1, height: fullHeight = 1 } = await sharp(png).metadata();
  const { data: trimmed, info } = await sharp(png)
    .trim({ background: TRANSPARENT, threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // sharp reports the offsets as negative numbers (where the original's corner now lies),
  // and leaves them out when nothing was trimmed.
  const left = -(info.trimOffsetLeft ?? 0);
  const top = -(info.trimOffsetTop ?? 0);
  const share = (value: number, side: number) => Math.min(1, Math.max(0, value / side));
  const box = {
    xMin: share(left, fullWidth),
    yMin: share(top, fullHeight),
    xMax: share(left + width, fullWidth),
    yMax: share(top + height, fullHeight),
  };
  const pad = Math.round(Math.max(width, height) * CUTOUT_PADDING);
  const webp = await sharp(trimmed)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 6 })
    .toBuffer();
  return { webp, box };
}

// A cut-out's box after its photo is turned a quarter clockwise, as rotateQuarter turns it: a
// point (x, y) goes to (1 − y, x). Turning the box is exact and costs nothing, where clearing
// it would leave a turned photo unable to dissolve into its cut-out.
export const rotateBoxQuarter = (box: ItemBox): ItemBox => ({
  xMin: 1 - box.yMax,
  yMin: box.xMin,
  xMax: 1 - box.yMin,
  yMax: box.xMax,
});

// A stored photo or cut-out turned a quarter clockwise, when the user asks: transparency kept.
export async function rotateQuarter(webp: Uint8Array): Promise<Uint8Array> {
  return sharp(webp)
    .rotate(90)
    .webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 6 })
    .toBuffer();
}

// The cut-out on white, for models that read colour pixels only: transparent pixels would
// otherwise come through as whatever colour they happen to hold.
export async function flattenOnWhite(image: Uint8Array): Promise<Uint8Array> {
  return sharp(image).flatten({ background: "#ffffff" }).png().toBuffer();
}

// Room added around an item's box, as a share of the photo's sides: the model's boxes sit
// tight, and a little context reads better than an item cut at its edges.
const CROP_MARGIN = 0.03;

// Crops one item out of a stored look photo by its box (relative 0..1), as a WebP.
export async function cropToBox(
  image: Uint8Array,
  box: { xMin: number; yMin: number; xMax: number; yMax: number },
): Promise<Uint8Array> {
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const left = Math.max(0, Math.floor((box.xMin - CROP_MARGIN) * width));
  const top = Math.max(0, Math.floor((box.yMin - CROP_MARGIN) * height));
  const right = Math.min(width, Math.ceil((box.xMax + CROP_MARGIN) * width));
  const bottom = Math.min(height, Math.ceil((box.yMax + CROP_MARGIN) * height));
  return sharp(image)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer();
}

// Side of the photos shown to the vision model when comparing items: enough to see colour,
// pattern and cut, and a few of them fit in one cheap request.
const THUMBNAIL_SIDE = 384;

// A small WebP on white (a cut-out's transparency flattened), for comparing items.
export async function thumbnail(image: Uint8Array): Promise<Uint8Array> {
  return sharp(image)
    .flatten({ background: "#ffffff" })
    .resize(THUMBNAIL_SIDE, THUMBNAIL_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

// How much of a cut-out's opaque area its biggest piece (two biggest for a pair of shoes or of
// earrings) must hold to count as one item. On the owner's wardrobe every cut-out of clothes
// was 99–100% one piece and a pair of boots two of ~50%; a shirt worn under an arm, a phone and
// feather cuffs came out as four pieces, the biggest 63% (2026-10-23).
const WHOLE_SHARE = 0.8;
const PAIR_SHARE = 0.9;
// The mask is measured small: piece sizes, not edges, are what count.
const MASK_SIDE = 160;

// Whether a cut-out is the item in one piece rather than the bits around what covered it (an
// arm, a phone, a bag strap). A broken one looks worse than the plain crop.
export async function isWhole(cutout: Uint8Array, category: string): Promise<boolean> {
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .extractChannel(3)
    .resize(MASK_SIDE, MASK_SIDE, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const seen = new Uint8Array(width * height);
  const sizes: number[] = [];
  // Connected opaque areas, flood-filled one by one.
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || data[start]! < 128) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      size++;
      const x = p % width;
      const neighbours = [
        x > 0 ? p - 1 : -1,
        x < width - 1 ? p + 1 : -1,
        p - width,
        p + width < width * height ? p + width : -1,
      ];
      for (const q of neighbours) {
        if (q >= 0 && !seen[q] && data[q]! >= 128) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total === 0) return false;
  sizes.sort((a, b) => b - a);
  const pair = category === "shoes" || category === "accessory";
  const kept = pair ? sizes[0]! + (sizes[1] ?? 0) : sizes[0]!;
  return kept / total >= (pair ? PAIR_SHARE : WHOLE_SHARE);
}
