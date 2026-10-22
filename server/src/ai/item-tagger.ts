import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ITEM_CATEGORIES,
  ITEM_COLORS,
  ITEM_CONDITIONS,
  ITEM_FITS,
  MATCH_KINDS,
  SEASONS,
  type AppLanguage,
  type ItemTags,
  type LookItem,
  type MatchKind,
} from "@closet-ai/shared";
import * as z from "zod/v4";

import { modelCopy } from "../modules/photos/process-photo.js";

// Every AI call goes through a module like this one, so tests swap in a stub and never spend money.
export interface ItemTagger {
  tag(image: Uint8Array, lang: AppLanguage): Promise<TaggedPhoto>;
  // Every item a person wears or carries on a look photo (a mirror selfie), each with its box.
  findItems(image: Uint8Array, lang: AppLanguage): Promise<LookItem[]>;
  // Whether one of the wardrobe items (the few closest by embedding) is the item cropped from a
  // look, or could stand in for it. index points into candidates; null when how is "none".
  compare(item: Uint8Array, candidates: MatchCandidate[]): Promise<MatchVerdict>;
}

// A wardrobe item to compare with: its photo (or cut-out on white) and its name.
export interface MatchCandidate {
  image: Uint8Array;
  name: string;
}

export interface MatchVerdict {
  how: MatchKind;
  index: number | null;
}

// An item photo's tags, plus whether someone is wearing the item in it. That only decides
// whether the photo is cut out, so it isn't stored with the tags.
export type TaggedPhoto = ItemTags & { onPerson: boolean };

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
  noun: z.string().max(60).nullable(),
  onPerson: z.boolean(),
});
// The model's boxes are clamped to 0..1 after parsing: a schema can't make it stay inside.
const modelLook = z.object({
  items: z.array(
    modelTags.omit({ recognized: true, onPerson: true }).extend({
      box: z.object({ xMin: z.number(), yMin: z.number(), xMax: z.number(), yMax: z.number() }),
    }),
  ),
});

// "why" comes first so the model reasons before it decides.
const modelVerdict = z.object({
  why: z.string(),
  how: z.enum(MATCH_KINDS),
  match: z.number().int().nullable(),
});

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameShape: Same<z.infer<typeof modelTags>, TaggedPhoto> = true;
const sameLookShape: Same<z.infer<typeof modelLook>["items"][number], LookItem> = true;
void sameShape;
void sameLookShape;

const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: "English",
  he: "Hebrew",
  ru: "Russian",
};

// How to fill in each tag; shared by both prompts.
const TAG_RULES = `
- recognized: false if there is no single clear item (a person wearing an outfit, a room, several items with none in focus, not clothing at all). Then use name "", category "top", empty colors and seasons, and null for the rest.
- name: 2–4 words in the language you are given, like a shop listing: colour, then a material or detail if it is clear, then the type ("White linen shirt", "Белая льняная рубашка"). No brand in the name.
- category: top (t-shirts, shirts, blouses, knitwear, hoodies), bottom (trousers, jeans, shorts, skirts), dress (dresses, jumpsuits), outerwear (coats, jackets, blazers), shoes, accessory (bags, belts, jewellery, hats, scarves).
- colors: from the palette only, the base colour first, then up to two clearly visible others; use multicolor only when no one or two colours dominate. Pick the nearest palette colour (mint is green, navy is blue, cream is beige).
- seasons: from the type and how heavy the fabric looks. Year-round items (jeans, plain t-shirts) get all four.
- fit, length, fabric, style: short English words, for search ("cropped", "knee-length", "linen", "cotton jersey", "denim", "casual", "minimal", "streetwear"). Fabric is a best guess from the texture; use null when you can't tell.
- brand: only if a logo or label is legible in the photo, otherwise null.
- condition: new, good or worn, from visible wear (pilling, fading, fraying, stains). Creases are not wear.
- noun: the item's type in English, 1–3 plain words, no colour ("ankle boots", "sandals", "shoulder bag", "leather midi skirt", "corduroy jacket"), for a model that cuts the item out of the photo by name.`;

const SYSTEM_PROMPT = `You tag photos for a wardrobe app. Each photo is meant to show one clothing item, pair of shoes, bag or accessory that the user owns, usually lying on a bed or floor or on a hanger. The background and anything at the edges of the frame (bedding, other clothes, feet) are not the item.

Fill in:
${TAG_RULES}
- onPerson: true if someone is wearing or holding the item (a selfie, a screenshot of an outfit), false if it lies, hangs or stands on its own.

When a field can't be read from the photo, use null rather than guessing.`;

const LOOK_PROMPT = `You read outfit photos for a wardrobe app, usually a mirror selfie. List every clothing item, pair of shoes, bag and accessory the person is wearing or carrying, so the user can add each to their wardrobe as a crop of this photo. Skip the phone, the mirror, the room and clothes lying around that the person isn't wearing. If there is no person or no clothing, return an empty list.

For each item fill in:
${TAG_RULES}
- box: the item's bounding box relative to the image, from 0 to 1: xMin and xMax from the left edge, yMin and yMax from the top edge. It covers the whole visible item and little else. A pair of shoes is one item with one box around both.

Seasons come from the item, not from the rest of the outfit. When a field can't be read from the photo, use null rather than guessing.`;

const COMPARE_PROMPT = `You compare an item cropped from an outfit photo with a few items from the user's wardrobe of the same category, to tell the user whether they already own it.

- why: a few words on what you see.
- how: same if a wardrobe item looks like the same item (type, colour, pattern, cut); similar if one is the same type in the same colour family and could stand in for it in the outfit (a pink checked shirt for a pink checked shirt, black wide trousers for black straight trousers); none if no wardrobe item could (a different kind of item, or a clearly different colour, pattern or material).
- match: the number of the best wardrobe item, or null when how is none.

Wardrobe photos may show the item worn, on a bed or cut out on white, in different light: judge the item, not the background or the person, and allow for a shift in shade (a pink that looks salmon or peach in a photo at home). When the crop shows no clear item, answer none.`;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function createClaudeItemTagger(apiKey: string): ItemTagger {
  const client = new Anthropic({ apiKey });

  const imageBlock = (image: Uint8Array): Anthropic.ImageBlockParam => ({
    type: "image",
    source: {
      type: "base64",
      media_type: "image/webp",
      data: Buffer.from(image).toString("base64"),
    },
  });

  // Photos in, one structured answer out.
  async function ask<T>(
    system: string,
    format: Parameters<typeof zodOutputFormat>[0],
    content: Anthropic.ContentBlockParam[],
  ): Promise<T> {
    const response = await client.messages.parse({
      model: TAGGING_MODEL,
      max_tokens: 8000,
      system,
      // Low effort: a quick look is enough to read items off a photo.
      output_config: { effort: "low", format: zodOutputFormat(format) },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      throw new TaggingRefusedError(
        `declined: ${response.stop_details?.category ?? "no category"}`,
      );
    }
    if (!response.parsed_output) {
      throw new Error(`no tags in the response (stop reason ${response.stop_reason})`);
    }
    return response.parsed_output as T;
  }

  // One photo, at the model's size, and the language to name its items in.
  const photoIn = async (
    image: Uint8Array,
    lang: AppLanguage,
  ): Promise<Anthropic.ContentBlockParam[]> => [
    imageBlock(await modelCopy(image)),
    { type: "text", text: `Language for the name: ${LANGUAGE_NAMES[lang]}.` },
  ];

  return {
    tag: async (image, lang) =>
      ask<TaggedPhoto>(SYSTEM_PROMPT, modelTags, await photoIn(image, lang)),

    async findItems(image, lang) {
      const { items } = await ask<z.infer<typeof modelLook>>(
        LOOK_PROMPT,
        modelLook,
        await photoIn(image, lang),
      );
      return items.map(({ box, ...item }) => {
        const [xMin, xMax] = [
          clamp(Math.min(box.xMin, box.xMax)),
          clamp(Math.max(box.xMin, box.xMax)),
        ];
        const [yMin, yMax] = [
          clamp(Math.min(box.yMin, box.yMax)),
          clamp(Math.max(box.yMin, box.yMax)),
        ];
        return { ...item, box: { xMin, yMin, xMax, yMax } };
      });
    },

    async compare(item, candidates) {
      const { how, match } = await ask<z.infer<typeof modelVerdict>>(COMPARE_PROMPT, modelVerdict, [
        { type: "text", text: "Item from the outfit:" },
        imageBlock(item),
        ...candidates.flatMap(({ image, name }, index): Anthropic.ContentBlockParam[] => [
          { type: "text", text: `Wardrobe item ${index}: ${name}` },
          imageBlock(image),
        ]),
      ]);
      // A verdict pointing nowhere counts as no match.
      if (how === "none" || match === null || !candidates[match])
        return { how: "none", index: null };
      return { how, index: match };
    },
  };
}
