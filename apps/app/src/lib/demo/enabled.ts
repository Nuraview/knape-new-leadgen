/**
 * The demo-data gate.
 *
 * WHY THIS IS NOT JUST A HOSTNAME CHECK. `isDemoMode` was
 * `location.hostname === "demo.nuraview.app"` — the vendor's own demo host.
 * That is useless for showing a white-labelled instance to its own client, and
 * it is the wrong shape for a flag whose entire job is to decide whether the
 * numbers on screen are real. A build has to be able to say so explicitly.
 *
 * SO IT IS OPT-IN, AT BUILD TIME. VITE_DEMO_DATA=true produces a demo build.
 * Anything else — unset, absent, "false", a typo — is a real build that serves
 * real data. There is deliberately no runtime switch, no query parameter and
 * no localStorage key: a URL that could flip real figures into invented ones
 * is a URL someone can be handed by accident, and the whole point of this file
 * is that nobody can mistake one for the other.
 *
 * WHAT IT GATES. Only the seeded outreach dataset in ./outreach-data, served
 * from fetchers/leadgen/client.ts. With the flag off, that interception does
 * not happen and every request goes to the API exactly as before.
 *
 * WHAT IT PROMISES. A build with this on ALWAYS shows the demo banner — see
 * components/demo-alert.tsx, which is mounted by the app shell and says in
 * plain words that the figures are sample data and nothing was sent. The flag
 * and the banner are one decision, not two: there is no combination of
 * settings that yields invented send figures with no notice attached.
 */

/**
 * True only when this build was made with VITE_DEMO_DATA=true.
 *
 * Written as a bare comparison against the raw literal — not
 * `String(...).trim().toLowerCase()` — so it can be ELIMINATED at build time.
 * Vite substitutes `import.meta.env.VITE_DEMO_DATA` with a literal, leaving
 * `undefined === "true"`, which Rollup folds to `false` and then drops every
 * branch guarded by it, including the import of the dataset itself.
 *
 * That matters for more than bundle size. The lenient version was not
 * statically foldable, so a production build shipped the whole seeded dataset
 * — invented company names, fabricated send counts and open rates — sitting
 * inert inside client-*.js where anyone reading the bundle would find it. Dead
 * code is one thing; dead code that manufactures plausible campaign metrics
 * does not belong in a client's production build at all.
 *
 * The cost of the strict comparison is that "TRUE", " true" and "1" no longer
 * count. That is the right trade: this flag is set once in a build command,
 * and being unambiguous is worth more than being forgiving.
 */
export const demoDataEnabled: boolean =
  import.meta.env.VITE_DEMO_DATA === "true";

/**
 * The vendor's own hosted demo, which additionally gets the "deploy your own"
 * call to action. Kept separate from demoDataEnabled so a CLIENT demo build
 * never shows the vendor's GitHub link — the same brand leak the signature and
 * favicon work in this repo already had to undo twice.
 */
export const isVendorDemoHost: boolean =
  typeof window !== "undefined" &&
  window.location.hostname === "demo.nuraview.app";
