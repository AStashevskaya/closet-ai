# Design rules ("The Thread")

The rules every screen follows, and the screens decided but not built yet. `docs/client.md` says how the built screens work; this file says why they look the way they do and what a new screen must keep. Prototypes live in `~/Desktop/closet/wrinkle-lab/`. Use the `fashion-creative-director` skill for anything significant.

## The signs and what they mean

Each sign means one thing everywhere. A sign used for decoration stops meaning anything.

- **The thread** (`colors.text`, the ink line) always connects two things: the tab bar, a closet rail, a piece and its outfits, her style and her looks, a piece and the rail it will hang on. A thread that only frames a form or a list is decoration: don't draw it.
- **Solid vs dashed.** Solid is hers. Dashed is not hers yet, not known yet, or optional: a piece from a photo, a wish, a partner piece, an empty hanger, an unknown profile value, an optional field (brand and price), a photo that couldn't be read. A thread turns solid when the piece comes into her closet.
- **The cherry bead** (`colors.bead`, `colors.onBead` on it) marks the small things to act on: the bright button, a selected chip, "+", a yes, a stop on the thread. Never a big block.
- **Powder blue** (`colors.ground`, thread-coloured text on it) means something new arriving or being edited right now (the first screen a new person sees, a new piece being added, a value open for editing in My profile, "New in your closet"), and it is the ground of the soft editorial blocks she should stop and read (a stylist's verdict, the brief's summary). It is never the header or the whole background of an ordinary screen, and never decoration (decided 2026-10-31).
- **The hand-drawn heart** only where love means something: a liked outfit, a look taken to heart, the piece one of whose outfits she liked. Everything else gets a plain loop or nothing (decided 2026-10-26).
- **Hangers and rails** are the closet. Anything that enters the closet hangs on a rail; anything she lacks is an empty dashed hanger.
- **Cut-outs vs prints.** A piece in her closet is a bare cut-out with a soft shadow tinted with the thread colour (`cutoutShadow`, never grey, never a card). A piece not in the closet yet (being added, waiting for its cut-out) is a white-bordered print. Only the hero print is tilted (about 3°); prints in a list tilt ±1° at most, or not at all (target from the prototypes, not in the code yet).
- **Handwriting** (`fonts.hand`: Marck Script for en and ru, Gveret Levin for he) is for short captions only: a date, a note, a label on a photo, the caption after "Hang it up". Never for anything she must read to act.

## Motion

- Things appear slowly, one after another: today `rise` in `src/motion.ts` (opacity and a 24 px rise over `durations.enter`, 900 ms, ease-out), staggered by `STAGGER_STEP` (110 ms). Touch feedback is quick.
- The prototypes since 2026-10-26 use a softer "bloom" (opacity, a 14 px rise and 0.98 scale over `durations.settle`, 1.4 s). It is the target, not built: when it is adopted, change `rise` in one place rather than adding a second entrance.
- Threads draw themselves in (about 2 s), then a bead may run once along them.
- **"Hang it up"** (built for one piece in `src/screens/add-item/hang-up.tsx`, the batch not yet) is the signature transition for anything entering the closet (decided 2026-10-31): the print sheds its white frame, the bare cut-out flies to its rail, its hanger appears, and it swings once and settles. In a batch the pieces go one after another (about 140 ms apart). Then a handwritten caption names the rail ("On the Tops rail") or the count ("6 pieces in your closet").
- **Waiting** (decided 2026-10-31, prototype `~/Desktop/closet/wrinkle-lab/design-loading`): a screen that waits is the same screen in its own layout, never a separate loading layout. Everything already known is on it (title, photo, rail, fields, the thread); one sign means "waiting" app-wide: a cherry bead running along that screen's own thread (the closet's rail; the add-item fields' thread; in Recreate the look, the curtain's line at the far edge where it will open from, and the beads' thread; the piece's thread on an outfits screen). When the result comes, the bead goes and each part settles into its place with a short fade; the screen does not enter again. Waiting is never drawn dashed: the running bead is the only thing that moves by itself, and everything dashed stands still and means "not hers". `HangerLoader` stays for the splash and small waits inside buttons.
- Re-rendering a screen in place (a tick, an opened row) never replays its entrance.
- Reduced motion: no flight, no swing, no drawing; things are simply there.

## Photos with marks on them

When the app marks things on a photo (pieces found on a selfie, on a look):

- Loops are drawn in two strokes, white and thread, so they hold on light and dark photos.
- Labels are placed largest piece first, each in the first free spot around its piece (above, beside, below, inside), never over another label, and tied to its piece by a short thread.
- A piece too small for a loop (sunglasses, a watch) gets a bead instead.
- A piece left out is shown by its loop going dashed and its label struck through.
- Screen readers get a plain list with checkboxes; the marks are hidden from them.
- Overlapping pieces are normal (a bag over a shirt over a vest): never draw one mark per piece blindly (see `slotsOf` in `src/screens/want-can/curtain.tsx`, PR #99).

## Words

- Russian addresses her as «ты». Copy is short and human: «Твой шкаф ждёт», not "Sign in to continue".
- Design for long Russian strings and for Hebrew (RTL, its own fonts). Photo pixels are never mirrored; layouts around them are.

## Decided, not built yet

All prototyped in `~/Desktop/closet/wrinkle-lab/design-adding`, direction "Выбрано" on each screen. One PR per screen, no data-model change.

- **Sign-up and sign-in (decided 2026-10-31).** One powder-blue band for both: the wordmark, the tagline in an outlined pill, and a rail with swaying hangers; below it the thread runs down to the fields as stops, the button is the bead at its end, a focused field fills with blue. Sign-up: empty hangers, "Your closet goes here". Sign-in: faint grey silhouettes appear on the hangers, "Your closet is waiting". Switching between them only fills or empties the hangers; the rest of the screen stays.
- **Adding a batch (decided 2026-10-31).** Three of the photos fanned on the blue band with "Read 6 of 7"; each piece a small print on the thread with its name, rail and a tick; a tap on the name opens its fields below; not read: a dashed empty print; still reading: a faded print with a spinner and an empty bead. Once the fan scrolls away a compact blue band slides in. "Hang N pieces" sends the ticked ones to the rail one after another.
- **A look from a selfie (decided 2026-10-31).** The photo full-bleed, each piece found looped and labelled by hand as in "Photos with marks on them"; a tap leaves a piece out; the bead "Add N pieces" at the bottom.
- **The Edit:** directions A / B / C in `~/Desktop/closet/wrinkle-lab/design-wishes`; not decided.
