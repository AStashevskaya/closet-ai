import { describe, expect, it } from "vitest";
import {
  kindOf,
  OFFER_FEATURES,
  OFFER_MIN_SCORE,
  OFFER_MODEL,
  offerFeatures,
  offerScore,
  offerText,
  rankOffers,
  SHOP_OFFERS,
  type OfferCandidate,
  type OfferFeatures,
  type OfferPiece,
} from "./offer-ranker";

// Similarities as the real models give them: image cosines around 0.6–0.8, and the text tower's
// cosines with pictures small, around 0 ± 0.05 (lab means 0.65 and 0.00).
const trousers: OfferPiece = {
  name: "Black leather trousers",
  noun: "leather trousers",
  category: "bottom",
  colors: ["black"],
  fabric: "leather",
};
const leatherTrousers: OfferCandidate = {
  name: "Faux leather straight trousers",
  colors: ["black"],
  similarity: 0.72,
  textSimilarity: 0.06,
};
const crepeSkirt: OfferCandidate = {
  name: "Crepe midi skirt",
  colors: ["black"],
  similarity: 0.76,
  textSimilarity: 0.01,
};

const shirt: OfferPiece = {
  name: "White shirt",
  noun: "oversized shirt",
  category: "top",
  colors: ["white"],
  fabric: "cotton",
};
const whiteShirt: OfferCandidate = {
  name: "Cotton poplin shirt",
  colors: ["white"],
  similarity: 0.66,
  textSimilarity: 0.07,
};
const redBlouse: OfferCandidate = {
  name: "Ruffled blouse",
  colors: ["red"],
  similarity: 0.74,
  textSimilarity: -0.01,
};

describe("offerFeatures", () => {
  it("computes fit.mjs's features", () => {
    const { textGap, ...skirt } = offerFeatures(trousers, crepeSkirt, 0.76, 0.06);
    expect(textGap).toBeCloseTo(0.05, 10);
    expect(skirt).toEqual({
      sim: 0.76,
      gapToTop: 0,
      sameKind: 0,
      nounOverlap: 0,
      colorJaccard: 1,
      noColorShared: 0,
      fabricMatch: 0,
      // Leather against crepe: both name a fabric, none shared.
      fabricClash: 1,
      accessory: 0,
      textSim: 0.01,
    });
    const fit = offerFeatures(trousers, leatherTrousers, 0.76, 0.06);
    expect(fit).toMatchObject({
      sameKind: 1,
      nounOverlap: 1,
      fabricMatch: 1,
      fabricClash: 0,
      textGap: 0,
    });
    expect(fit.gapToTop).toBeCloseTo(0.04, 10);
  });

  it("compares colours as sets", () => {
    const features = offerFeatures(
      { ...shirt, colors: ["white", "blue"] },
      { ...whiteShirt, colors: ["white", "black"] },
      0.7,
      0.1,
    );
    expect(features.colorJaccard).toBeCloseTo(1 / 3, 10);
    expect(features.noColorShared).toBe(0);
    expect(offerFeatures(shirt, redBlouse, 0.74, 0.07).noColorShared).toBe(1);
  });

  it("finds no kind in a name without English words", () => {
    expect(kindOf("Top handle bags")).toBe("bag");
    expect(kindOf("Bag XL")).toBe("bag");
    expect(kindOf("T-shirt")).toBe("shirt");
    expect(kindOf("Юбка")).toBe("");
    const russian = { ...trousers, name: "Кожаные брюки", noun: null, fabric: null };
    expect(offerFeatures(russian, { ...crepeSkirt, name: "Брюки" }, 0.76, 0.06).sameKind).toBe(0);
  });

  it("marks accessories, which rarely fit", () => {
    const bag: OfferPiece = { ...trousers, category: "accessory", noun: "tote bag" };
    expect(offerFeatures(bag, crepeSkirt, 0.76, 0.06).accessory).toBe(1);
  });
});

describe("offerScore", () => {
  it("is the logistic of the standardised features", () => {
    // Every feature at its training mean: only the bias is left.
    const atMean = Object.fromEntries(
      OFFER_FEATURES.map((feature, j) => [feature, OFFER_MODEL.mean[j]]),
    ) as OfferFeatures;
    expect(offerScore(atMean)).toBeCloseTo(1 / (1 + Math.exp(-OFFER_MODEL.b)), 12);
    expect(OFFER_MODEL.w).toHaveLength(OFFER_FEATURES.length);
  });

  it("puts a crepe skirt below a leather trouser for leather trousers", () => {
    const top = 0.76;
    const fit = offerScore(offerFeatures(trousers, leatherTrousers, top, 0.06));
    const miss = offerScore(offerFeatures(trousers, crepeSkirt, top, 0.06));
    expect(fit).toBeGreaterThan(miss);
    // Ranked together, the trouser leads (the skirt looks closer by picture).
    expect(rankOffers(trousers, [crepeSkirt, leatherTrousers])[0]!.name).toBe(leatherTrousers.name);
  });

  it("puts a red blouse below a white shirt for a white shirt, though it looks closer", () => {
    const fit = offerScore(offerFeatures(shirt, whiteShirt, 0.74, 0.07));
    const miss = offerScore(offerFeatures(shirt, redBlouse, 0.74, 0.07));
    expect(fit).toBeGreaterThan(miss);
    expect(rankOffers(shirt, [redBlouse, whiteShirt])[0]!.name).toBe(whiteShirt.name);
  });
});

describe("rankOffers", () => {
  it("keeps the candidates above the threshold, best first, at most three", () => {
    const fits = [0.06, 0.08, 0.07, 0.065].map((textSimilarity, i) => ({
      ...whiteShirt,
      name: `Cotton shirt ${i}`,
      textSimilarity,
    }));
    const offers = rankOffers(shirt, [redBlouse, ...fits]);
    expect(offers).toHaveLength(SHOP_OFFERS);
    expect(offers.map((offer) => offer.textSimilarity)).toEqual([0.08, 0.07, 0.065]);
    expect(offers[0]!.score).toBeGreaterThanOrEqual(offers[1]!.score);
  });

  it("offers only a bag for a bag, however close a hat is in words", () => {
    const bag: OfferPiece = {
      name: "Black tote",
      noun: "leather tote bag",
      category: "accessory",
      colors: ["black"],
      fabric: "leather",
    };
    // The closest by picture and by words (textGap 0): the model alone would offer it.
    const hat: OfferCandidate = {
      name: "Leather bucket hat",
      colors: ["black"],
      similarity: 0.82,
      textSimilarity: 0.16,
    };
    const tote: OfferCandidate = {
      ...hat,
      name: "Tote bag",
      similarity: 0.72,
      textSimilarity: 0.15,
    };
    expect(offerScore(offerFeatures(bag, hat, 0.82, 0.16))).toBeGreaterThanOrEqual(OFFER_MIN_SCORE);
    expect(rankOffers(bag, [hat, tote]).map((offer) => offer.name)).toEqual(["Tote bag"]);
    // Without an English noun there is no kind to check, so no accessory at all.
    expect(rankOffers({ ...bag, noun: null }, [hat, tote])).toEqual([]);
  });

  it("lets shoes cross kinds: mules for loafers", () => {
    const loafers: OfferPiece = {
      name: "Black loafers",
      noun: "leather loafers",
      category: "shoes",
      colors: ["black"],
      fabric: "leather",
    };
    const mules: OfferCandidate = {
      name: "Leather mules",
      colors: ["black"],
      similarity: 0.78,
      textSimilarity: 0.1,
    };
    expect(rankOffers(loafers, [mules]).map((offer) => offer.name)).toEqual(["Leather mules"]);
  });

  it("offers nothing from nothing", () => {
    expect(rankOffers(shirt, [])).toEqual([]);
  });

  it("asks the text tower about colour, fabric and the kind of piece", () => {
    expect(offerText(trousers)).toBe("black leather leather trousers");
    expect(offerText({ ...shirt, colors: [], fabric: null, noun: null })).toBe("White shirt");
  });
});
