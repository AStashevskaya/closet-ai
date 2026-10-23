import sharp from "sharp";

// SAM 3 on fal.ai cuts the item out of its photo, asked by name ("garment"): $0.005 a photo,
// about 3 s. Background removers that keep "the main subject" (BiRefNet, Bria RMBG) were tried
// first on the owner's test photos and kept the bedspread and feet along with the item; asking
// for the garment by name doesn't.

// Every background removal goes through a module like this one, so tests swap in a stub and
// never spend money.
export interface BackgroundRemover {
  // The item on a transparent background, as a PNG the size of the input; null when the model
  // found no item in the photo. `name` asks for a particular item ("leather skirt") when the
  // photo shows several, as a worn look does. `pair` keeps every instance found (both shoes of
  // a pair come back as separate masks, and one alone looks like half a pair). `trim` also asks
  // for "garment" and keeps the item's feathers, fringe or fur when the name alone leaves them out.
  removeBackground(
    image: Uint8Array,
    name?: string,
    options?: { pair?: boolean; trim?: boolean },
  ): Promise<Uint8Array | null>;
}

const ENDPOINT = "https://fal.run/fal-ai/sam-3/image";
// What SAM 3 is asked to find. Works for tops, bottoms and dresses on the test photos; check
// shoes and bags once there are photos of them.
const PROMPT = "garment";
// A cut-out comes back in a few seconds; past this something is stuck and the job retries.
const TIMEOUT_MS = 60_000;

// For a pair: masks this sure (relative to the best one) count as part of it. On the owner's
// photos both shoes scored within 0.1 of each other, and the whole pair as one mask a bit lower.
const PAIR_SCORE_SHARE = 0.75;
// Masks much smaller than the biggest are bits of the neighbouring shoes at the frame's edge,
// not the other shoe of the pair.
const PAIR_AREA_SHARE = 0.3;
const MAX_MASKS = 4;

// Asked by name, SAM 3 leaves out a trim: "sweater" without its feathers ("feather-trim sweater"
// and "feathers" find nothing), "shirt" without its feather cuffs. One of the "garment" masks is
// the whole piece (the sweater's best one, the shirt's fourth at 0.57). It counts as the same
// piece when it holds nearly all of the named mask (both owner's photos: 97–100%) and isn't much
// bigger (1.3× and 2.1× with the trim; the shorts beside the sweater hold none of it).
const TRIM_CONTAINS = 0.9;
const TRIM_MAX_GROWTH = 2.5;

const fromDataUri = (url: string) => {
  if (!url.startsWith("data:")) throw new Error("background removal returned a URL, not data");
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
};

// The photo with everything outside the union of the masks made transparent. Built as raw RGBA:
// sharp runs removeAlpha after joinChannel, which would drop the new alpha again.
async function applyMasks(image: Uint8Array, masks: Buffer[]): Promise<Uint8Array> {
  const { data: rgb, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) rgb.copy(rgba, i * 4, i * 3, i * 3 + 3);
  for (const mask of masks) {
    const alpha = await sharp(mask).resize(width, height).extractChannel(0).raw().toBuffer();
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4 + 3] = Math.max(rgba[i * 4 + 3]!, alpha[i]!);
    }
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

const opaque = async (mask: Buffer, width: number, height: number) =>
  (await sharp(mask).resize(width, height).extractChannel(0).raw().toBuffer()).map((v) =>
    v > 127 ? 1 : 0,
  );

// The biggest of `candidates` that is the named piece with more around it (its trim), or null.
export async function maskWithTrim(named: Buffer, candidates: Buffer[]): Promise<Buffer | null> {
  const { width = 0, height = 0 } = await sharp(named).metadata();
  const inside = await opaque(named, width, height);
  const namedArea = inside.reduce((sum, v) => sum + v, 0);
  if (namedArea === 0) return null;
  let best: { mask: Buffer; area: number } | null = null;
  for (const mask of candidates) {
    const pixels = await opaque(mask, width, height);
    let area = 0;
    let shared = 0;
    for (let i = 0; i < pixels.length; i++) {
      area += pixels[i]!;
      shared += pixels[i]! & inside[i]!;
    }
    const sameItem = shared >= namedArea * TRIM_CONTAINS && area <= namedArea * TRIM_MAX_GROWTH;
    if (sameItem && area > namedArea && area > (best?.area ?? 0)) best = { mask, area };
  }
  return best?.mask ?? null;
}

export function createFalBackgroundRemover(apiKey: string): BackgroundRemover {
  const ask = async (image: Uint8Array, prompt: string, extra: object) => {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // A data URI, so the photo is never uploaded to fal's public file storage.
        image_url: `data:image/webp;base64,${Buffer.from(image).toString("base64")}`,
        prompt,
        output_format: "png",
        // The result comes back as a data URI too, and stays out of fal's request history.
        sync_mode: true,
        ...extra,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`background removal failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as {
      image?: { url?: string } | null;
      masks?: { url: string }[] | null;
      metadata?: { score: number }[] | null;
    };
  };

  const masksOf = async (image: Uint8Array, prompt: string) => {
    const body = await ask(image, prompt, {
      apply_mask: false,
      return_multiple_masks: true,
      max_masks: MAX_MASKS,
      include_scores: true,
    });
    const masks = body.masks ?? [];
    return masks.map((mask, i) => ({
      mask: fromDataUri(mask.url),
      score: body.metadata?.[i]?.score ?? 1,
    }));
  };

  return {
    async removeBackground(image, name = PROMPT, { pair = false, trim = false } = {}) {
      if (trim && !pair && name !== PROMPT) {
        const found = await masksOf(image, name);
        if (found.length === 0) return null;
        const named = found.reduce((a, b) => (b.score > a.score ? b : a)).mask;
        // Only once the piece is found: a name that misses costs one call, as before.
        const garments = await masksOf(image, PROMPT);
        const whole = await maskWithTrim(
          named,
          garments.map((g) => g.mask),
        );
        return applyMasks(image, whole ? [named, whole] : [named]);
      }
      if (!pair) {
        // The photo with everything but the best mask made transparent.
        const url = (await ask(image, name, { apply_mask: true })).image?.url;
        return url ? fromDataUri(url) : null;
      }
      const masks = await masksOf(image, name);
      if (masks.length === 0) return null;
      const best = Math.max(...masks.map((m) => m.score));
      const sure = masks.filter((m) => m.score >= best * PAIR_SCORE_SHARE).map((m) => m.mask);
      const areas = await Promise.all(
        sure.map(async (mask) => (await sharp(mask).extractChannel(0).stats()).channels[0]!.sum),
      );
      const biggest = Math.max(...areas);
      return applyMasks(
        image,
        sure.filter((_, i) => areas[i]! >= biggest * PAIR_AREA_SHARE),
      );
    },
  };
}
