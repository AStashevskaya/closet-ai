# Product decisions

The roadmap and the product decisions behind it, with dates. Read before changing a feature's scope, limits, Free/Premium split or how partner items appear.

## Roadmap (v1, in order)

0. ~~Client foundation: i18n (en, he, ru) and Jest (jest-expo + Testing Library).~~ Done.
1. ~~Basic auth: email + password via Better Auth, sessions in Postgres, cookie in `expo-secure-store`, `/api/items` protected, items get `owner_id`.~~ Done.
2. ~~Image upload and storage: SeaweedFS locally, Cloudflare R2 (free tier) in production.~~ Done: uploads go through the API (re-encoded to a WebP of at most 2.6 MP, metadata stripped) rather than presigned URLs, so nothing reaches storage unprocessed.
3. ~~BullMQ job queue for image processing (upload returns immediately, worker processes, client polls or gets SSE).~~ Done: the client polls; the worker also cleans up unattached photos.
4. ~~Item tagging with a vision model~~ (done: tags on the photo, form pre-fill, seasons editable and the photo's details shown on the item screen; the details are read-only and stay on the photo): structured output validated with Zod. Tags: type, colour, fit, length, fabric, style, brand guess, condition, seasons. Seasons are filled by the model, not asked in the add-item form (an extra step people skip or guess at; type and fabric give it away); the user can correct them on the item. An all-season item gets all four, so an empty list only ever means "not tagged yet".
5. ~~Item embeddings + pgvector~~ (done for images: similar items on the item screen; text search still to come, it needs query translation), the base for every "find similar" feature.
6. Item `source` field: `own` / `resale` / `brand_partner`.
7. **Look screenshot → what you have** (built as the "Want" tab; becomes Inspiration, see "Feature boundaries"), then **"Want / Can" for one item** → similar for less. Priority feature: one of the first things a new user tries, works even with an empty wardrobe.
8. ~~Background removal~~ (done: SAM 3 on fal.ai, free for everyone; see "Photo polish: free and Premium" below).
9. Wardrobe sharing table (owner, grantee, permissions) for stylists later.
10. "What do I wear this with?" from a single item. From its first version, store every suggested outfit with the user's reaction (liked, saved, wore it, skipped, friends' votes): the data for "Outfit taste" below.
11. Declutter: keep / sell / not sure.
12. Listing generator (Russian first, then Hebrew; price range), shared via the OS share sheet to Kufar, Telegram or Instagram in Belarus (Yad2 in Israel).
13. Sign in with Apple / Google, free-tier limits (count AI actions per user and device), RevenueCat trial. Want / Can split between free and Premium: see "Free and Premium" in the Want / Can section.
14. Prompt evals: a few test wardrobes and look screenshots, scored by hand, rerun after each prompt change. Start collecting the set at step 4. The owner scores outfits on the 1–5 scale from the stylist questionnaire.

## Photo polish: free and Premium (decided 2026-10-19)

Compared on the owner's 7 test photos (script and side-by-side page in `~/Desktop/closet/wrinkle-lab`):

| | Model | Cost a photo | Who gets it |
|---|---|---|---|
| Background removal | SAM 3 on fal.ai ("garment") | $0.005 | everyone, automatically |
| "Make it nice": wrinkles smoothed, white studio background | Nano Banana edit on fal.ai | $0.04 | Premium, on a button |

- Removal is cheap enough to give away (150 items ≈ $0.75) and it also makes "similar" better.
- Smoothing costs about $4–6 for a first wardrobe of 100–150 items, then $0.20–0.40 a month: fine inside a subscription, not as a free feature. Free users get 3 to try; Premium gets a monthly cap (around 50) so no account costs more than it pays.
- It is a button, never automatic, and the original is kept: edit models sometimes change the item itself (Nano Banana turned a checked shirt into one with buttons; Seedream invents text under logos). FLUX Kontext keeps the item but barely smooths. Revisit cheaper models (open FLUX Kontext, Qwen with acceleration, ~$0.01–0.02) once there are users.

Items from a mirror selfie (tried 2026-10-19 on the owner's 7 selfies, scripts `mirror.mjs`, `cheap.mjs`, `boxes.mjs` in `~/Desktop/closet/wrinkle-lab`):

- Haiku finds the items well (4–8 a selfie, down to sunglasses and a chain belt) and its boxes are tight enough to crop by: that is the free version, built.
- SAM 3 cut-outs of worn items come out in pieces (hidden by an arm or the phone, two items merged, 5 of 36 not found): not used for selfies.
- Nano Banana redrawing each item as a product photo looks great but is an approximation (a shirt tied round the waist redrawn whole, text on a print invented). Premium, per item on a button, with "try again" and "back to the original", marked as an AI version; same cap as smoothing.
- Cheaper redraws ($0.02: FLUX Kontext dev, FLUX.2, Qwen Edit Plus) changed the items too often (a top became a dress, colours and logos invented). Stay with Nano Banana; rerun `cheap.mjs` when new models come out.

## Outfit taste: how the AI learns to put good outfits together

No model training to start with: the taste comes from the prompt, from examples and from feedback, in this order. For now the owner is the stylist; an outside stylist comes with the stylist feature (step 9).

1. **Style guide in the prompt.** The owner fills in the stylist questionnaire ([doc](https://claude.ai/code/artifact/080bdeac-3673-4e9d-b3de-ea1d20a20bf8): colour, proportions, fabrics, occasions, weather, shoes and accessories, taboos, 10–20 example outfits, the 1–5 scale). Its answers become the style guide the outfit prompts are built on, kept in the repo next to the prompt.
2. **Reference outfits.** The owner's example outfits (and ones she picks, with permission) are embedded and stored; before composing, the closest references are retrieved with pgvector and shown to the model as the direction to follow. Taste changes by editing the library, not by retraining.
3. **Feedback.** Suggested outfits and reactions are stored from step 10 on. First as statistics (which combinations land); with a few thousand rated outfits, a small ranker on the embeddings picks the best of several AI suggestions and adapts to each user.
4. **Evals.** The owner scores the first 30–50 AI outfits on the questionnaire's 1–5 scale with a line on what is off; that set is rerun after every prompt change (step 14), and the "what is off" lines feed new rules and taboos.
5. **Fine-tuning** an open vision model only if 1–4 stop being enough, and only once thousands of rated outfits exist.

## Feature boundaries (decided 2026-10-21)

| | Input | What the user gets |
|---|---|---|
| **Want / Can** (Хочу / Могу) | One item they want: a screenshot or a link (a Balenciaga jacket) | Similar for less from partner brands and resale; the closest piece they already own; later, what to sell to afford the original |
| **Inspiration** (Вдохновение) | Whole looks they like: screenshots, Pinterest via the share sheet, onboarding style cards | The look rebuilt from their wardrobe, what's missing for it, and their taste profile |
| **My style** (Мой стиль) | Everything above plus reactions to outfits | A readable taste summary (the Opus brief), used by outfits and every recommendation |
| **Outfits** (Образы) | The wardrobe + My style | Outfits to wear, with like / not mine / wore it |

- What is built today as the Want tab (look screenshot → items → wardrobe matches) is the first version of Inspiration; it moves there when Want / Can is rebuilt for a single item.
- Taste is per person, never global: one user's likes never shape another user's outfits.
- Onboarding style cards are images we generate once (an image model) and store as static assets shown to every user; never Pinterest or other people's photos (copyright, Pinterest's terms). A user's own screenshots are fine: they are for their private use only and never shown to anyone else.

Outfit prototype (owner's wardrobe, `~/Desktop/closet/wrinkle-lab/outfits`): a plain prompt gives correct but dull outfits; a stylist prompt (hero piece, colour story, proportions, draft many, keep the best) with Opus is much better. The design to build: Opus writes the user's brief (taste from Inspiration, liked outfits and the wardrobe; hero pieces, pairings, traps, wardrobe gaps) when those change (~10 ¢), Haiku composes outfits from the brief per request (a few cents; keep its effort low).

## Partner items in recommendations (decided 2026-10-21)

Brands will pay to have their items shown. Every feature that recommends is built so a partner item can appear in it from the start, with these rules:

- **Separate catalog.** Partner items live in their own catalog (brand = organization from the brand portal, price, link, photos, embedding, status), never in anyone's wardrobe. A user's item only becomes "theirs" if they buy it and add it.
- **Where they can appear:** Want / Can results (the main place); "what's missing" for an Inspiration look; in an outfit: shoes or a bag where the wardrobe has none that suits the look (every look has both, decided 2026-10-23), and now and then one other piece ("finish it with…") where the wardrobe has nothing as good; wardrobe gaps from My style ("black straight trousers would unlock 5 of your saved looks").
- **Relevance first.** Candidates are ranked by fit to the item, look or taste; payment only boosts among items that already fit, and never outranks a clearly better match or a piece the user owns. Besides shoes and bags that finish a look, at most one partner item per outfit, in no more than two of the three.
- **Always labelled** as a partner item / ad in the UI, in every language.
- **Data model:** a stored outfit's pieces reference either a wardrobe item or a catalog item (one of two nullable columns plus the slot), with a `sponsored` flag, so outfits with partner pieces need no rewrite later.
- **Measured per impression:** shown, opened, clicked through, saved, bought (when the brand reports it), for the brand dashboard. Brands see aggregates only, never who the user is or their wardrobe and taste profile.
- Free and Premium both see partner items (partners pay for reach); Premium may later get fewer.

## "Want / Can": look screenshot → what you have, what you can buy

> Written before the 2026-10-21 split: the look-screenshot flow below is now Inspiration, and Want / Can takes a single item (see "Feature boundaries"). The steps and rules still hold for Inspiration.

The user drops in a screenshot of a look they like (Pinterest, Instagram, a photo). The app splits it into items and rebuilds the look from the user's wardrobe and partner brands.

Flow:

1. Upload the screenshot through the existing photo pipeline (`POST /api/photos`). It is processed as a background job like other AI work.
2. A vision model returns the items it sees, validated with a Zod schema in `shared`: for each item `category`, `color`, `cut`/`silhouette`, `length`, `fabric`, `style`, a short description, a bounding box (relative 0–1 coords) and a `confidence`. Items that are cut off or hidden are returned with low confidence or skipped; never guess.
3. For each item, crop the screenshot by its box and search by image embedding plus text description (pgvector):
   - first the user's own wardrobe (`source = own`);
   - then partner brands (`brand_partner`); until partners exist, use the demo live search below behind the same interface;
   - later resale.
4. Result per item: `owned` (best match from the wardrobe, similarity score), `buy` (up to 3 brand items with price and link), or `missing` (nothing close enough). Thresholds live in one config so they can be tuned.
5. Summary for the whole look: how many items the user already has ("3 of 5 from your wardrobe") and the rough cost of the rest.

UI (client): screenshot at the top with item boxes, then one row per item: the detected item, the user's match or the brand options, and an honest "couldn't make out the shoes" when confidence is low. A "save as outfit" action and a share card ("I rebuilt this Pinterest look from my wardrobe") for the videos.

Rules:
- Results from brands are labelled as partner items once real partners exist; a brand never outranks a clearly better match.
- Counts against the free-tier AI limits (one screenshot = one action, whatever the number of items).

Free and Premium (decided 2026-10-19):

| | Free | Premium |
|---|---|---|
| Look screenshots | 3–5 per month | unlimited |
| Matches from the user's wardrobe | yes | yes |
| Partner brand options | yes | yes |
| Save the look as an outfit, history of looks | no | yes |
| "Sell what you don't wear to afford it" (listing on Kufar; Yad2 in Israel) | no | yes |
| Price comparison and sale alerts | no | yes |

Why not Premium-only: Want / Can is what a new user tries first and what the share cards spread, so a paywall at the first screenshot loses people before they see it work. A free look costs about $0.01 (vision model to find and compare the items + our own pgvector search). Brand options stay free because partners pay for impressions and clicks: hiding them would shrink what we can offer partners. The limit is set by value, not cost: users hit it once the feature is a habit, which is when the trial and the subscription are offered.

Cost (estimates, October 2026; check before committing): recognising the items in a screenshot is ~$0.001 on Claude Haiku 5.5, and comparing each with its wardrobe candidates another ~$0.002 an item (~$0.01 a screenshot as built) (compare with Gemini Flash on the eval set, mainly for box accuracy); wardrobe and partner-catalog search run on our own Postgres. The live brand search below (~$5–8 per 1,000 searches) is the only expensive part, and it is demo-only.
- The screenshot belongs to the user's private use; don't publish or reuse it anywhere.
- Add 15–20 real look screenshots with hand-written expected items to the eval set.

## Demo: brand recommendations via live search (for pitching brands)

Goal: show brands and partners how the app recommends their items, before any partner has given us a catalog. This is a demo feature, not the production design.

How it works:

1. A config file holds a plain list of brand sites: `server/src/modules/showroom/demo-sites.ts` exporting `DEMO_SITES: { name: string; url: string; instagram?: string }[]`. Order matters: the first sites are searched first, so before a meeting with a specific brand we move that brand to the top.
2. Input: a user item or one item cropped from a "Want / Can" look screenshot. The vision model turns it into a short search description (type, colour, cut, length, fabric), validated with a Zod schema.
3. Search only within the listed domains through a web search API that supports domain filtering (pick one, explain the choice and the cost per request). No crawling, no storing the sites' catalogs, no Instagram scraping.
4. The model looks at the found product pages and returns the 3-5 closest items: title, price if shown, image URL, product URL, brand name, and a one-line reason why it matches.
5. Every result links to the brand's own site.
6. Cache results per query for a day so the demo is fast and cheap.
7. Behind a feature flag (`SHOWROOM_SOURCE=demo-search | partners-db`). Partners-db is the future mode where we search our own stored catalog of brands that agreed. Switching must not touch the client.

Also for the demo: a simple "Brand dashboard" screen (web, can be static data for now) showing impressions, clicks to the brand's site, and the user queries that surfaced their items.

Rules:
- Demo only: not shown in public builds, store screenshots or marketing until the brand has agreed.
- Low request volume, respect robots.txt, remove a brand immediately if they ask.
- Results labelled as partner/ads in the UI once real partners exist.

