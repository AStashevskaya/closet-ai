// SAM 3 on fal.ai cuts the item out of its photo, asked by name ("garment"): $0.005 a photo,
// about 3 s. Background removers that keep "the main subject" (BiRefNet, Bria RMBG) were tried
// first on the owner's test photos and kept the bedspread and feet along with the item; asking
// for the garment by name doesn't.

// Every background removal goes through a module like this one, so tests swap in a stub and
// never spend money.
export interface BackgroundRemover {
  // The item on a transparent background, as a PNG the size of the input; null when the model
  // found no item in the photo. `name` asks for a particular item ("leather skirt") when the
  // photo shows several, as a worn look does.
  removeBackground(image: Uint8Array, name?: string): Promise<Uint8Array | null>;
}

const ENDPOINT = "https://fal.run/fal-ai/sam-3/image";
// What SAM 3 is asked to find. Works for tops, bottoms and dresses on the test photos; check
// shoes and bags once there are photos of them.
const PROMPT = "garment";
// A cut-out comes back in a few seconds; past this something is stuck and the job retries.
const TIMEOUT_MS = 60_000;

export function createFalBackgroundRemover(apiKey: string): BackgroundRemover {
  return {
    async removeBackground(image, name = PROMPT) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // A data URI, so the photo is never uploaded to fal's public file storage.
          image_url: `data:image/webp;base64,${Buffer.from(image).toString("base64")}`,
          prompt: name,
          // The photo with everything but the mask made transparent.
          apply_mask: true,
          output_format: "png",
          // The result comes back as a data URI too, and stays out of fal's request history.
          sync_mode: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`background removal failed: ${response.status} ${await response.text()}`);
      }
      const body = (await response.json()) as { image?: { url?: string } | null };
      const url = body.image?.url;
      if (!url) return null;
      if (!url.startsWith("data:")) throw new Error("background removal returned a URL, not data");
      return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    },
  };
}
