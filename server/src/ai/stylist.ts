import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  BUY_CALLS,
  ITEM_CATEGORIES,
  type AppLanguage,
  type MissingPiece,
  type OutfitMood,
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
  "claude-haiku-5-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 3, output: 15 },
  "claude-opus-5-5": { input: 5, output: 25 },
} as const;
type Model = keyof typeof PRICES;

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
  // Partner brands' pieces she could add where her wardrobe falls short, on a contact sheet of
  // their own, numbered after the wardrobe; null when there are none to offer.
  shop: { pieces: StylistPiece[]; sheet: Uint8Array } | null;
  // What her last few requests already used: sheet pieces with the number of looks they were
  // in, and the looks' names. Fresh pieces and ideas are preferred over them.
  recent: { pieces: { n: number; looks: number }[]; captions: string[] };
  // An item she doesn't own yet and is thinking of buying: the pieces of its category she owns
  // that are closest to it (cosine of the embeddings, which see shape more than colour), for the
  // verdict. null for her own items.
  buying: { closest: { n: number; similarity: number }[] } | null;
  season: Season;
  // What the user asked the looks to be for; null for any.
  mood: OutfitMood | null;
  lang: AppLanguage;
  looks: number;
}

// What each mood asks of the looks, for the model.
const MOODS: Record<OutfitMood, string> = {
  everyday: "an ordinary day: errands, coffee, a walk; easy to move in, no fuss",
  office:
    "a day at work in a creative office: put together, covered enough, comfortable from morning to evening",
  evening: "an evening out: dinner, drinks, a date; more polish, shine or an edge",
  sporty: "sporty-chic: sneakers or flats, relaxed shapes, an athletic touch, still styled",
  surprise: "surprise her: combinations she wouldn't think of herself, bold but wearable",
};

export interface ComposedLook {
  // Wardrobe numbers that go with the hero.
  items: number[];
  // Shop pieces' numbers: shoes or a bag her wardrobe lacks for the look, or a brand's piece.
  partners: number[];
  missing: MissingPiece | null;
  caption: string;
  occasion: string;
  why: string;
}

export interface ComposedVerdict {
  call: (typeof BUY_CALLS)[number];
  reason: string;
  // The number of the piece she owns that it nearly repeats.
  twin: number | null;
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
  compose(
    input: ComposeInput,
  ): Promise<{ looks: ComposedLook[]; verdict: ComposedVerdict | null; costMicros: number }>;
  // Starts writing a brief; returns the batch id to check on.
  submitBrief(input: BriefInput): Promise<string>;
  briefResult(batchId: string): Promise<BriefResult>;
}

const LANGUAGE_NAMES: Record<AppLanguage, string> = { en: "English", he: "Hebrew", ru: "Russian" };

const composed = z.object({
  looks: z.array(
    z.object({
      items: z.array(z.number().int()),
      partners: z.array(z.number().int()),
      missing: z.object({ category: z.enum(ITEM_CATEGORIES), description: z.string() }).nullable(),
      caption: z.string(),
      occasion: z.string(),
      why: z.string(),
    }),
  ),
  verdict: z
    .object({ call: z.enum(BUY_CALLS), reason: z.string(), twin: z.number().int().nullable() })
    .nullable(),
});

const COMPOSE_PROMPT = `You are the client's personal stylist, editorial rather than catalogue. She shows you one item (the first image; she owns it) and asks what to wear it with.

You get her whole wardrobe in words, a contact sheet of the numbered pieces worth considering this time, and, when there is one, the senior stylist's brief on her taste.

Compose the asked number of looks built around the item:
- The item is in every look; list the wardrobe numbers that go with it, from the contact sheet (another piece from her wardrobe list only when it is clearly better). Every piece you mention in why is in the look's numbers.
- A complete look: with a dress, nothing else is required; otherwise a top and a bottom (the item counts as its category).
- One top per look. A shirt is a top, not a layer: never a shirt or a vest over another top. A second layer only when the season calls for one: a jacket, coat or cardigan over the top. A dress, or a light top that is the point of the look, stands alone: nothing over it, and never a top over a dress.
- One idea per look: every piece tells the same story, in the same register (not half a shirt-and-sneakers look and half a top-and-sandals one).
- Fabrics and shoes agree in weight and season: no boots or a puffer with linen and a mini, no heavy sneakers and a jacket with a light linen top, bare legs in a short skirt only when it's warm.
- A statement piece (tweed, sequins, feathers, a bold print) goes in only where its colour and texture suit the item, never just to add interest. Next to a precious piece the rest is plain but fine: a ribbed tank cheapens a satin or embroidered skirt.
- Every look has shoes and a bag (the item counts if it is one): the pair and the bag from her wardrobe that suit that look best. One pair and one bag per look.
- The looks go in different directions, in this order: (1) her core style; (2) one of the looks she saved, recreated: take a recipe from the brief's "recreating her saves" that works with the item, or build the closest one, and say in why which saved look it echoes; (3) a step out of her comfort zone that still flatters her; (4) an unexpected mix of moods or textures. With fewer looks asked, take them from the start of this list. Each look has its own idea (a colour story, a play of proportions), different occasions across the looks, and none a stylist would call obvious or shapeless.
- why speaks only of the item and the pieces listed in the look; a piece she doesn't own belongs in missing, never in why.
- Don't lean on the same pieces: no wardrobe piece in more than two looks, and if the sheet has an alternative, use it. Four looks that share their top, jacket or shoes read as one look. A statement texture (tweed, sequins, feathers, leather) other than the item's own goes in one look of the four at most, whichever pieces carry it.
- Without a brief, read her taste from the wardrobe itself. With one, its hero pieces explain her taste; they are not pieces to put in every look: each in one look at most.
- She asks often, so freshness matters: prefer pieces her recent looks didn't use, and new names and ideas, whenever they work about as well.
- partners: numbers from the shop sheet when one is given (see the request); otherwise empty.
- missing: if one more piece she doesn't own would clearly make the look, describe it as a shop search would need it (type, colour, material, shape), with its category; otherwise null. At most one per look, and not in every look.
- verdict: only when the request says she is thinking of buying the item; otherwise null. See the request.
- caption: a short scrapbook-style name for the look, 2–4 words, with some wit. occasion: a few words. why: one sentence, the stylist's idea, not a list of the pieces; if you can't say honestly why the pieces work together, compose another look. All three, and missing.description, in the language asked.
- Every text she reads (why, caption, verdict.reason) speaks to her directly: "you", in Russian the informal «ты», in Hebrew the plural form the app uses; never "she" or "the client". Name pieces by what they are ("your grey ribbed tank"), never by their numbers.`;

const BRIEF_PROMPT = `You are a sought-after personal stylist. Write a working brief for a junior stylist who will put together this client's outfits every day from her wardrobe (numbered contact sheets and the list below). In English, compact, under 500 words:
1. Her taste, read first from the looks she saved (if any; how she wants to look, newest first: weigh the newest most and say where her taste is moving), then her wardrobe and the outfits she liked or rejected: what she gravitates to, what makes a look "hers". Where a saved look asks for something the wardrobe can get close to, say how, by number. Her taste can be wider than her wardrobe: don't shrink it to what she owns.
2. Hero pieces (by number) and what each one wants next to it.
3. Pairings and colour stories that work in this wardrobe, with numbers.
4. Traps: combinations that look obvious, dated or shapeless here, and anything she rejected.
5. Gaps: up to three pieces she doesn't own that would unlock the most looks.`;

const describe = (p: StylistPiece) =>
  `#${p.n} ${p.name} | ${p.category} | ${p.colors.join("/")} | ${p.seasons.join("/") || "?"}${p.details ? ` | ${p.details}` : ""}`;

// Her recent looks, so the new ones don't repeat them.
const recentText = ({ pieces, captions }: ComposeInput["recent"]) =>
  [
    pieces.length
      ? `\nAlready in her recent looks (number × looks): ${pieces.map((p) => `#${p.n} × ${p.looks}`).join(", ")}. Use these only where nothing else on the sheet works as well, and at most one of them per look.`
      : "",
    captions.length
      ? `\nNames of her recent looks (don't reuse them or their ideas): ${captions.map((c) => `"${c}"`).join(", ")}.`
      : "",
  ].join("");

// For an item she may buy: the verdict's rules, and the owned pieces most like it.
const buyingText = ({ closest }: NonNullable<ComposeInput["buying"]>) =>
  `\nShe doesn't own the item yet and is thinking of buying it. ${closest.length ? `The pieces of its kind she owns that are most like it (similarity of shape and texture, colour barely counts): ${closest.map((c) => `#${c.n} (${c.similarity.toFixed(2)})`).join(", ")}.` : "She owns nothing of its kind."} Give a verdict: buy when it makes several strong looks with her wardrobe and adds something she lacks; think when it works but with a catch (few looks, needs a piece she doesn't have, close to something she owns); skip when it nearly repeats a piece she owns (same kind, colour and style) or hardly goes with her wardrobe. twin: the number of the piece it nearly repeats, else null. reason: one concrete sentence to her, in the language asked, about her wardrobe (what gap it fills, or which piece it repeats, by name), not about the looks' captions.`;

// The shop sheet's rules: relevance first, and never instead of a piece she owns.
const shopText = (pieces: StylistPiece[]) =>
  `\nThe third image is a shop sheet: pieces from partner brands she doesn't own.\n${pieces.map(describe).join("\n")}\nShop pieces go in the look's partners, never in items, in two cases:
- Shoes or a bag, only when no pair or bag of hers on the contact sheet could go with that look. Hers come first; never a second pair or bag next to hers.
- To show her a brand's piece she'd love: in about two of the looks, one piece that truly suits the look and that her wardrobe has nothing as good for. Quietly: the look is still hers.
A look with a shop piece needs no missing for that slot.`;

const jpegBlock = (image: Uint8Array): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(image).toString("base64") },
});

function costOf(model: Model, usage: Anthropic.Usage, batch = false): number {
  const { input, output } = PRICES[model];
  const tokens =
    (usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * 0.1) *
      input +
    usage.output_tokens * output;
  return Math.round(tokens * (batch ? 0.5 : 1));
}

export function createClaudeStylist(
  apiKey: string,
  // Which model composes: Haiku by default; others are compared in experiments.
  composingModel: Model = COMPOSING_MODEL,
): Stylist {
  const client = new Anthropic({ apiKey });

  return {
    async compose(input) {
      const response = await client.messages.parse({
        model: composingModel,
        // Room for thinking: 4000 cut the answer off mid-JSON on every try for a shoe from a
        // photo (2026-10-23). Only the tokens used are paid for.
        max_tokens: 8000,
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
              ...(input.shop ? [jpegBlock(input.shop.sheet)] : []),
              {
                type: "text",
                text: `The item (first image): ${input.hero.name} | ${input.hero.category} | ${input.hero.colors.join("/")}${input.hero.details ? ` | ${input.hero.details}` : ""}\nThe contact sheet (second image) shows the pieces to choose from.${recentText(input.recent)}${input.buying ? buyingText(input.buying) : ""}${input.shop ? shopText(input.shop.pieces) : ""}\nSeason: ${input.season}.${input.mood ? ` Mood she asked for: ${MOODS[input.mood]}. This comes first: every look, and every occasion, is for this mood (no office look when she asked for sporty); the directions above vary the looks within it.` : ""} Language: ${LANGUAGE_NAMES[input.lang]}. Compose ${input.looks} looks.`,
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
        // Only asked for an item she may buy; dropped if the model answers one anyway.
        verdict: input.buying ? response.parsed_output.verdict : null,
        costMicros: costOf(composingModel, response.usage),
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
