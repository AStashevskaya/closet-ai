import sharp from "sharp";

// Photos are stored small on purpose: free storage tiers are measured in gigabytes.
// 1024 px on the long side is enough for the phone, for listings and for vision models.
export const PHOTO_MAX_SIDE = 1024;
const WEBP_QUALITY = 70;
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

  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // apply the EXIF orientation before the EXIF data is dropped
    .resize({
      width: PHOTO_MAX_SIDE,
      height: PHOTO_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer();
}

// Room left around a cut-out item, as a share of its longer side, so it doesn't touch the edges
// of a card.
const CUTOUT_PADDING = 0.06;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

// Turns the background remover's PNG into the stored cut-out: the empty margins trimmed, a
// little even padding added back, WebP with transparency.
export async function processCutout(png: Uint8Array): Promise<Uint8Array> {
  const trimmed = await sharp(png).trim({ background: TRANSPARENT, threshold: 10 }).toBuffer();
  const { width = 0, height = 0 } = await sharp(trimmed).metadata();
  const pad = Math.round(Math.max(width, height) * CUTOUT_PADDING);
  return sharp(trimmed)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .webp({ quality: WEBP_QUALITY, alphaQuality: 90, effort: 6 })
    .toBuffer();
}

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
