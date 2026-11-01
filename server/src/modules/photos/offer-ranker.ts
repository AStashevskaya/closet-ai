import type { ItemColor, LookItem } from "@closet-ai/shared";

// Which partner pieces "Recreate the look" offers for a piece on the screenshot: a small logistic
// regression the owner trained on her own labels, instead of a cut-off on image similarity alone.
// Image similarity can't tell a black leather trouser from a black crepe skirt, or a white shirt
// from a red blouse cut the same way; the name, colours, fabric and the text tower can.
//
// The lab is the spec: ~/Desktop/closet/wrinkle-lab/partner-rank (prep.ts builds the candidates,
// text.ts adds textSim, fit.mjs defines `features()` and trains). Leave-one-look-out on 120
// labelled pieces (2026-11-01): image ≥ 0.65 showed a right piece for 20 of 49 pieces that had
// one, at precision 0.13, and only wrong pieces for 39; this model at 0.7: 35/49, 0.43, 25.
//
// To retrain: label more in the lab (label.mjs), run `node fit.mjs`, copy model.json into
// OFFER_MODEL below and rerun this module's tests. A new feature changes `offerFeatures` too,
// and must be computed here exactly as in fit.mjs, or the weights mean something else.

export const SHOP_OFFERS = 3;
// The score is the model's probability that the owner would call the piece a fit. The threshold
// was picked from fit.mjs's table of thresholds (0.5 to 0.9), where 0.7 gave the numbers above.
export const OFFER_MIN_SCORE = 0.7;

// The candidate pool the model was trained on (prep.ts): the closest by image, plus a few more of
// the same kind by name that the image misses (22 of 97 fits weren't in the image top 10, white
// shirts mostly).
export const POOL_BY_IMAGE = 10;
export const POOL_BY_KIND = 4;

export const OFFER_FEATURES = [
  "sim",
  "gapToTop",
  "sameKind",
  "nounOverlap",
  "colorJaccard",
  "noColorShared",
  "fabricMatch",
  "fabricClash",
  "accessory",
  "textSim",
  "textGap",
] as const;
type Feature = (typeof OFFER_FEATURES)[number];
export type OfferFeatures = Record<Feature, number>;

type Model = { w: number[]; b: number; mean: number[]; sd: number[] };

// model.json from fit.mjs, 2026-11-01: 120 pieces on 26 of the owner's look screenshots, 1301
// (piece, candidate) pairs, 97 of them fits, against the dev catalog of 259 items. Weights are on standardised
// features (value minus mean, over sd), in OFFER_FEATURES order: textSim, the accessory flag
// (accessories rarely fit) and textGap matter most.
export const OFFER_MODEL: Model = {
  w: [
    0.06529978272128538, 0.0834863899763224, 0.22209213011929027, 0.07135553709102117,
    0.03813138649988317, -0.11447021814448678, -0.04576373218386564, -0.2081749781952285,
    -0.7479272012107574, 0.7086050459094247, -0.4112655556482896,
  ],
  b: -1.0936356056869962,
  mean: [
    0.6452693312836287, 0.061512451960030676, 0.28823981552651806, 0.1917755572636434,
    0.12042018959774532, 0.8455034588777863, 0.08070714834742505, 0.24519600307455802,
    0.3382013835511145, -0.0030705611068408915, 0.05271229823212914,
  ],
  sd: [
    0.09440829526828481, 0.04493839081119452, 0.45294329034853376, 0.29400564450269273,
    0.30225439463561027, 0.3614240721140219, 0.2723848464086303, 0.4302033509293207,
    0.47309746111687206, 0.04299640549917692, 0.03706561462140258,
  ],
};

// English words of 3+ letters, singular by a dropped final "s" ("Wide-leg trousers" → wide,
// leg, trouser). Crude, and exactly what fit.mjs did.
const words = (text: string | null | undefined) =>
  (text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2)
    .map((word) => word.replace(/s$/, ""));

// The kind of piece: the last such word ("top handle bag" and "Shoulder bag" are both bags).
// catalog.repository computes the same in SQL for the candidate pool.
export const kindOf = (text: string | null | undefined) => words(text).at(-1) ?? "";

// Fabric words the feeds use in names, grouped so "leather" and "faux leather" meet.
const FABRICS = [
  "leather",
  "denim",
  "linen",
  "silk",
  "satin",
  "wool",
  "knit",
  "cotton",
  "suede",
  "tweed",
  "chiffon",
  "georgette",
  "jersey",
  "velvet",
  "lace",
  "mesh",
  "poplin",
  "cashmere",
  "corduroy",
  "crepe",
  "sequin",
];
const fabricsIn = (text: string) =>
  new Set(FABRICS.filter((fabric) => text.toLowerCase().includes(fabric)));

export type OfferPiece = Pick<LookItem, "name" | "noun" | "category" | "colors" | "fabric">;
export type OfferCandidate = {
  // The English name: the feed's words are what the model learned from.
  name: string;
  colors: ItemColor[];
  // Cosine of the catalog picture with the piece's crop, and with its description in words.
  similarity: number;
  textSimilarity: number;
};

// What the text tower is asked about the piece: "white cotton poplin shirt", colour, fabric and
// the kind of piece, as the model's training captions read.
export const offerText = (piece: OfferPiece) =>
  [piece.colors.join(" "), piece.fabric, piece.noun ?? piece.name].filter(Boolean).join(" ");

// fit.mjs `features()`, one for one. top and topText are the best of the piece's whole pool, so
// gapToTop and textGap say how far a candidate is behind the closest one.
export function offerFeatures(
  piece: OfferPiece,
  candidate: OfferCandidate,
  top: number,
  topText: number,
): OfferFeatures {
  const noun = piece.noun || piece.name;
  const nounWords = words(noun);
  const nameWords = new Set(words(candidate.name));
  const pieceColors = new Set(piece.colors);
  const candidateColors = new Set(candidate.colors);
  const shared = [...pieceColors].filter((color) => candidateColors.has(color)).length;
  const union = new Set([...pieceColors, ...candidateColors]).size;
  const pieceFabrics = fabricsIn(`${piece.fabric ?? ""} ${piece.noun ?? ""} ${piece.name}`);
  const candidateFabrics = fabricsIn(candidate.name);
  const fabricMatch = [...pieceFabrics].some((fabric) => candidateFabrics.has(fabric)) ? 1 : 0;
  const kind = kindOf(noun);
  return {
    sim: candidate.similarity,
    gapToTop: top - candidate.similarity,
    // fit.mjs compared the kinds as they were; every labelled piece had an English kind. A piece
    // named only in Russian has none here, and nothing should count as its kind.
    sameKind: kind && kind === kindOf(candidate.name) ? 1 : 0,
    nounOverlap: nounWords.length
      ? nounWords.filter((word) => nameWords.has(word)).length / nounWords.length
      : 0,
    colorJaccard: union ? shared / union : 0,
    noColorShared: pieceColors.size && candidateColors.size && shared === 0 ? 1 : 0,
    fabricMatch,
    // Both name a fabric and none is shared: leather trousers vs a crepe skirt.
    fabricClash: pieceFabrics.size && candidateFabrics.size && !fabricMatch ? 1 : 0,
    accessory: piece.category === "accessory" ? 1 : 0,
    textSim: candidate.textSimilarity,
    textGap: topText - candidate.textSimilarity,
  };
}

// The model's probability that the candidate fits.
export function offerScore(features: OfferFeatures, model: Model = OFFER_MODEL): number {
  const z = OFFER_FEATURES.reduce(
    (sum, feature, j) => sum + ((features[feature] - model.mean[j]!) / model.sd[j]!) * model.w[j]!,
    model.b,
  );
  return 1 / (1 + Math.exp(-z));
}

// The offers for a piece: candidates scoring at least OFFER_MIN_SCORE, best first, at most
// SHOP_OFFERS of them.
export function rankOffers<T extends OfferCandidate>(
  piece: OfferPiece,
  candidates: T[],
): (T & { score: number })[] {
  if (candidates.length === 0) return [];
  const top = Math.max(...candidates.map((candidate) => candidate.similarity));
  const topText = Math.max(...candidates.map((candidate) => candidate.textSimilarity));
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: offerScore(offerFeatures(piece, candidate, top, topText)),
    }))
    .filter((candidate) => candidate.score >= OFFER_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHOP_OFFERS);
}
