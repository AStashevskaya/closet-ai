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
