import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ITEM_CATEGORIES,
  ITEM_COLORS,
  ITEM_CONDITIONS,
  ITEM_FITS,
  SEASONS,
  type AppLanguage,
  type ItemTags,
} from "@closet-ai/shared";
import * as z from "zod/v4";

// Every AI call goes through a module like this one, so tests swap in a stub and never spend money.
export interface ItemTagger {
  tag(image: Uint8Array, lang: AppLanguage): Promise<ItemTags>;
}

// The model declined the photo. Retrying the same photo won't change that.
export class TaggingRefusedError extends Error {}

// Haiku: tagging is extraction from one photo, run for every item. About $0.0006 a photo.
export const TAGGING_MODEL = "claude-haiku-5-5";

// The schema the model answers in. The SDK's helper takes Zod 4 schemas, while the API's
// schemas in shared are Zod 3 (fastify-type-provider-zod needs that), so this one is built
// from the same constants and the check below fails the build if the two shapes drift apart.
const modelTags = z.object({
  recognized: z.boolean(),
  name: z.string().max(120),
  category: z.enum(ITEM_CATEGORIES),
  colors: z.array(z.enum(ITEM_COLORS)).max(5),
  seasons: z.array(z.enum(SEASONS)),
  fit: z.enum(ITEM_FITS).nullable(),
  length: z.string().max(40).nullable(),
  fabric: z.string().max(60).nullable(),
  style: z.string().max(60).nullable(),
  brand: z.string().max(60).nullable(),
  condition: z.enum(ITEM_CONDITIONS).nullable(),
});
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameShape: Same<z.infer<typeof modelTags>, ItemTags> = true;
void sameShape;

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  he: "Hebrew",
  ru: "Russian",
};

const SYSTEM_PROMPT = `You tag photos for a wardrobe app. Each photo is meant to show one clothing item, pair of shoes, bag or accessory that the user owns, usually lying on a bed or floor or on a hanger. The background and anything at the edges of the frame (bedding, other clothes, feet) are not the item.

Fill in:
- recognized: false if there is no single clear item (a person wearing an outfit, a room, several items with none in focus, not clothing at all). Then use name "", category "top", empty colors and seasons, and null for the rest.
- name: 2–4 words in the language you are given, like a shop listing: colour, then a material or detail if it is clear, then the type ("White linen shirt", "Белая льняная рубашка"). No brand in the name.
- category: top (t-shirts, shirts, blouses, knitwear, hoodies), bottom (trousers, jeans, shorts, skirts), dress (dresses, jumpsuits), outerwear (coats, jackets, blazers), shoes, accessory (bags, belts, jewellery, hats, scarves).
- colors: from the palette only, the base colour first, then up to two clearly visible others; use multicolor only when no one or two colours dominate. Pick the nearest palette colour (mint is green, navy is blue, cream is beige).
- seasons: from the type and how heavy the fabric looks. Year-round items (jeans, plain t-shirts) get all four.
- fit, length, fabric, style: short English words, for search ("cropped", "knee-length", "linen", "cotton jersey", "denim", "casual", "minimal", "streetwear"). Fabric is a best guess from the texture; use null when you can't tell.
- brand: only if a logo or label is legible in the photo, otherwise null.
- condition: new, good or worn, from visible wear (pilling, fading, fraying, stains). Creases are not wear.

When a field can't be read from the photo, use null rather than guessing.`;

export function createClaudeItemTagger(apiKey: string): ItemTagger {
  const client = new Anthropic({ apiKey });

  return {
    async tag(image, lang) {
      const response = await client.messages.parse({
        model: TAGGING_MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        // Low effort: a quick look is enough to read an item off a photo.
        output_config: { effort: "low", format: zodOutputFormat(modelTags) },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/webp",
                  data: Buffer.from(image).toString("base64"),
                },
              },
              { type: "text", text: `Language for the name: ${LANGUAGE_NAMES[lang]}.` },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") {
        throw new TaggingRefusedError(
          `declined: ${response.stop_details?.category ?? "no category"}`,
        );
      }
      if (!response.parsed_output) {
        throw new Error(`no tags in the response (stop reason ${response.stop_reason})`);
      }
      return response.parsed_output;
    },
  };
}
