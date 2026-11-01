---
name: closet-outfit-eval
description: Compare a change to outfit composing (the stylist prompt, candidate picking, registers, the style brief) or to any ranking (partner offers, wardrobe matches) against a fixed set and the owner's own ratings. Use before merging a change that claims better looks or better picks.
disable-model-invocation: true
---

# Evaluating looks and picks

The owner's labels are the ground truth; a fluent "why" is not evidence. The labs in `~/Desktop/closet/wrinkle-lab` are where this happens, not the repo:

- `outfit-eval/`: `rate.mjs` (local page to rate generated looks, `ratings.json`, rounds), `findings.md` (what the ratings taught: one top per look, nothing over a dress, …).
- `partner-rank/`: `prep.ts` (candidates), `label.mjs` (page: which candidates fit), `fit.mjs` (features, logistic regression, leave-one-look-out evaluation), `model.json` (weights copied into `server/src/modules/photos/offer-ranker.ts`).

Steps:

1. **Name what changed** and the baseline (commit or prompt version). Keep the input set fixed for both: the same wardrobe, the same pieces or screenshots.
2. **Reuse the existing set first.** Add cases only for what the change targets: a small wardrobe, a missing category, a statement piece, a dress, shoes or a bag as the styled piece, season, a disliked look with its reason.
3. **Hard checks, by script, no model needed:** valid JSON, every piece id is hers and exists, no invented possessions, a dress or a top plus a bottom, one bottom, nothing over a dress, 3 looks returned (count how often fewer), the registers labelled (everyday / dressed up / bold).
4. **Soft ratings by the owner,** blind: baseline and candidate looks shuffled on one page, without saying which is which. Rating pages follow `rate.mjs` / `label.mjs` (local Node server, answers saved after every item, keyboard shortcuts, Russian UI).
5. **Paid runs only within a budget the owner named** (a compose call is ~3 ¢). Say the cost before running and what it was after. An LLM judge may sort, never decide.
6. **Report:** a small table baseline vs candidate (hard-check failures, mean rating, share rated good, looks per request, latency, cost per request), two or three counterexamples with pictures, and adopt / revise / reject. With data this small, say the numbers are rough; for a ranker, evaluate leave-one-look-out and pick the threshold from that, not from the training fit.

Write durable lessons into the lab's `findings.md`, and the decision into `docs/server.md` with the date when it ships.
