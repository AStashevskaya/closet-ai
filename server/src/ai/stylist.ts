import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ITEM_CATEGORIES,
  type AppLanguage,
  type MissingPiece,
  type Season,
} from "@closet-ai/shared";
import * as z from "zod/v4";

// The one module that asks a model for outfits and for the user's style brief; tests use
// createStubStylist. Design from the owner's prototype (2026-10-20, wrinkle-lab/outfits): a
// plain prompt gives correct but dull outfits; a stylist prompt with a brief of the user's
// taste, written once by a strong model, lets a cheap model compose good ones per request.

// Composes per request: cheap, and good with the brief.
export const COMPOSING_MODEL = "claude-haiku-5-5";
// Writes the brief now and then, in the background, through the Batch API (half price).
export const BRIEF_MODEL = "claude-opus-5-5";

// $ per million tokens, October 2026 list prices; check before quoting. Cache writes cost
// 1.25× the input price, cache reads 0.1×; the Batch API halves everything.
const PRICES = {
  [COMPOSING_MODEL]: { input: 1, output: 5 },
  [BRIEF_MODEL]: { input: 5, output: 25 },
} as const;

export interface StylistPiece {
  // The item's number on the contact sheet and in the wardrobe list.
  n: number;
  name: string;
  category: string;
  colors: string[];
  seasons: string[];
  // Fit, length, fabric, style as tagged, when known.
  details: string;
}

export interface ComposeInput {
  hero: Omit<StylistPiece, "n"> & { image: Uint8Array };
  // The whole wardrobe in words: the same for every request until the wardrobe changes, so it
  // sits in the cached part of the prompt.
  wardrobe: StylistPiece[];
  // The pieces worth considering this time, on one numbered contact sheet (JPEG).
  sheet: Uint8Array;
  brief: string | null;
  season: Season;
  lang: AppLanguage;
  looks: number;
}

export interface ComposedLook {
  // Wardrobe numbers that go with the hero.
  items: number[];
  missing: MissingPiece | null;
  caption: string;
  occasion: string;
  why: string;
}

export interface BriefInput {
  wardrobe: StylistPiece[];
  // The wardrobe on numbered contact sheets (JPEG).
  sheets: Uint8Array[];
  // Looks the user saved because they like them (JPEG), newest first.
  inspiration: Uint8Array[];
  // Outfits they reacted to, in words.
  liked: string[];
  disliked: string[];
}

export type BriefResult =
  | { status: "pending" }
  | { status: "done"; brief: string; costMicros: number }
  | { status: "failed"; reason: string };

export interface Stylist {
  compose(input: ComposeInput): Promise<{ looks: ComposedLook[]; costMicros: number }>;
  // Starts writing a brief; returns the batch id to check on.
  submitBrief(input: BriefInput): Promise<string>;
  briefResult(batchId: string): Promise<BriefResult>;
}

const LANGUAGE_NAMES: Record<AppLanguage, string> = { en: "English", he: "Hebrew", ru: "Russian" };

const composed = z.object({
  looks: z.array(
    z.object({
      items: z.array(z.number().int()),
      missing: z.object({ category: z.enum(ITEM_CATEGORIES), description: z.string() }).nullable(),
      caption: z.string(),
      occasion: z.string(),
      why: z.string(),
    }),
  ),
});

const COMPOSE_PROMPT = `You are the client's personal stylist, editorial rather than catalogue. She shows you one item (the first image; she owns it) and asks what to wear it with.

You get her whole wardrobe in words, a contact sheet of the numbered pieces worth considering this time, and, when there is one, the senior stylist's brief on her taste.

Compose the asked number of looks built around the item:
- The item is in every look; list only the wardrobe numbers that go with it, from the contact sheet.
- A complete look: with a dress, nothing else is required; otherwise a top and a bottom (the item counts as its category). A shirt, vest or jacket may be layered over a top or a dress when it helps. Shoes when a pair truly suits.
- Each look has its own idea (a colour story, a play of proportions, a mix of moods or textures), true to her taste. Different occasions across the looks. No look that a stylist would call obvious or shapeless.
- Without a brief, read her taste from the wardrobe itself.
- missing: if one more piece she doesn't own would clearly make the look (often shoes or a bag), describe it as a shop search would need it (type, colour, material, shape), with its category; otherwise null. At most one per look, and not in every look.
- caption: a short scrapbook-style name for the look, 2–4 words, with some wit. occasion: a few words. why: one sentence, the stylist's idea, not a list of the pieces. All three, and missing.description, in the language asked.`;

const BRIEF_PROMPT = `You are a sought-after personal stylist. Write a working brief for a junior stylist who will put together this client's outfits every day from her wardrobe (numbered contact sheets and the list below). In English, compact, under 500 words:
1. Her taste, read from the looks she saved (if any; how she wants to look), her wardrobe and the outfits she liked or rejected: what she gravitates to, what makes a look "hers". Where a saved look asks for something the wardrobe can get close to, say how, by number.
2. Hero pieces (by number) and what each one wants next to it.
3. Pairings and colour stories that work in this wardrobe, with numbers.
4. Traps: combinations that look obvious, dated or shapeless here, and anything she rejected.
5. Gaps: up to three pieces she doesn't own that would unlock the most looks.`;

const describe = (p: StylistPiece) =>
  `#${p.n} ${p.name} | ${p.category} | ${p.colors.join("/")} | ${p.seasons.join("/") || "?"}${p.details ? ` | ${p.details}` : ""}`;

const jpegBlock = (image: Uint8Array): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(image).toString("base64") },
});

function costOf(model: keyof typeof PRICES, usage: Anthropic.Usage, batch = false): number {
  const { input, output } = PRICES[model];
  const tokens =
    (usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * 0.1) *
      input +
    usage.output_tokens * output;
  return Math.round(tokens * (batch ? 0.5 : 1));
}

export function createClaudeStylist(apiKey: string): Stylist {
  const client = new Anthropic({ apiKey });

  return {
    async compose(input) {
      const response = await client.messages.parse({
        model: COMPOSING_MODEL,
        max_tokens: 4000,
        system: COMPOSE_PROMPT,
        // Low effort: the hard thinking is in the brief.
        output_config: { effort: "low", format: zodOutputFormat(composed) },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Her wardrobe:\n${input.wardrobe.map(describe).join("\n")}\n\n${
                  input.brief ? `The senior stylist's brief:\n${input.brief}` : "No brief yet."
                }`,
                // Everything up to here is the same for her next requests: cached at a tenth of the price.
                cache_control: { type: "ephemeral" },
              },
              jpegBlock(input.hero.image),
              jpegBlock(input.sheet),
              {
                type: "text",
                text: `The item (first image): ${input.hero.name} | ${input.hero.category} | ${input.hero.colors.join("/")}${input.hero.details ? ` | ${input.hero.details}` : ""}\nThe contact sheet (second image) shows the pieces to choose from.\nSeason: ${input.season}. Language: ${LANGUAGE_NAMES[input.lang]}. Compose ${input.looks} looks.`,
              },
            ],
          },
        ],
      });
      if (!response.parsed_output) {
        throw new Error(`no outfits in the response (stop reason ${response.stop_reason})`);
      }
      return {
        looks: response.parsed_output.looks,
        costMicros: costOf(COMPOSING_MODEL, response.usage),
      };
    },

    async submitBrief(input) {
      const content: Anthropic.ContentBlockParam[] = [
        ...input.sheets.map(jpegBlock),
        ...input.inspiration.map(jpegBlock),
        {
          type: "text",
          text: [
            `The first ${input.sheets.length} image(s): her wardrobe. ${input.inspiration.length ? `The next ${input.inspiration.length}: looks she saved because she likes them.` : "She hasn't saved any looks yet."}`,
            `Wardrobe:\n${input.wardrobe.map(describe).join("\n")}`,
            input.liked.length
              ? `Outfits she liked or wore:\n${input.liked.map((l) => `- ${l}`).join("\n")}`
              : "",
            input.disliked.length
              ? `Outfits she rejected:\n${input.disliked.map((l) => `- ${l}`).join("\n")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ];
      const batch = await client.messages.batches.create({
        requests: [
          {
            custom_id: "brief",
            params: {
              model: BRIEF_MODEL,
              max_tokens: 16000,
              thinking: { type: "adaptive" },
              output_config: { effort: "high" },
              system: BRIEF_PROMPT,
              messages: [{ role: "user", content }],
            },
          },
        ],
      });
      return batch.id;
    },

    async briefResult(batchId) {
      const batch = await client.messages.batches.retrieve(batchId);
      if (batch.processing_status !== "ended") return { status: "pending" };
      for await (const entry of await client.messages.batches.results(batchId)) {
        if (entry.result.type !== "succeeded")
          return { status: "failed", reason: entry.result.type };
        const message = entry.result.message;
        const brief = message.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n");
        if (!brief) return { status: "failed", reason: `empty (${message.stop_reason})` };
        return { status: "done", brief, costMicros: costOf(BRIEF_MODEL, message.usage, true) };
      }
      return { status: "failed", reason: "no result" };
    },
  };
}
