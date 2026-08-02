// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { messageOf } from "./failure";
import { loadFontRange } from "./font-ranges";

/**
 * The unit the returned geometry is measured in: thousandths of an em.
 *
 * Part of the interface, not an internal detail — a caller cannot place a
 * typeset run without it. Scale by `em / UNITS_PER_EM` to reach canvas units.
 */
export const UNITS_PER_EM = 1000;

/**
 * The typesetting pipeline, booted once on first use.
 *
 * MathJax v4 is a large, purely optional dependency, so its modules are pulled
 * in dynamically: the app starts without them and the first submit awaits the
 * import. Later submits reuse the same promise, so the engine is built once.
 */
let pipeline: Promise<(latex: string) => Promise<Element>> | undefined;

function mathjaxPipeline(): Promise<(latex: string) => Promise<Element>> {
  pipeline ??= bootMathJax().catch((failure: unknown) => {
    // A failed boot must not stay memoized, or one bad moment — an offline
    // prewarm, a chunk that did not arrive — would fail every label from then
    // on. Forgetting it lets the next caller try again.
    pipeline = undefined;
    throw failure;
  });
  return pipeline;
}

/** How long to wait for an idle moment before loading the engine anyway. */
const PREWARM_TIMEOUT = 2000;

/**
 * Start loading the engine once the page has drawn, so the first label does not
 * pay for it.
 *
 * The engine is a ~1 MB chunk fetched on demand; without this the user waits
 * for it at the exact moment they ask for a label. Resolves once the engine is
 * ready, or once the attempt has failed — a failure is deliberately silent
 * here, because nothing is waiting on it and {@link typesetLatex} will retry
 * the boot and report to whoever actually submits.
 */
export async function prewarmTypesetting(): Promise<void> {
  await whenIdle();
  try {
    await mathjaxPipeline();
  } catch {
    // Left for the first real submit to surface.
  }
}

/** Yield until the browser has drawn and has nothing better to do. */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(
        () => {
          resolve();
        },
        { timeout: PREWARM_TIMEOUT },
      );
      return;
    }
    // jsdom, and browsers without idle callbacks: the next macrotask still runs
    // after the current frame has been painted, which is the point.
    setTimeout(resolve);
  });
}

async function bootMathJax(): Promise<(latex: string) => Promise<Element>> {
  const [{ mathjax }, { TeX }, { SVG }, { browserAdaptor }, { RegisterHTMLHandler }] =
    await Promise.all([
      import("@mathjax/src/js/mathjax.js"),
      import("@mathjax/src/js/input/tex.js"),
      import("@mathjax/src/js/output/svg.js"),
      import("@mathjax/src/js/adaptors/browserAdaptor.js"),
      import("@mathjax/src/js/handlers/html.js"),
      // TeX packages have to be registered before the input jax is constructed.
      import("@mathjax/src/js/input/tex/base/BaseConfiguration.js"),
      import("@mathjax/src/js/input/tex/ams/AmsConfiguration.js"),
    ]);

  RegisterHTMLHandler(browserAdaptor());
  // Route glyph-range loading through the bundler before anything can ask for
  // one. Without this MathJax has no loader at all and silently draws missing
  // glyphs as system-font <text>.
  mathjax.asyncLoad ??= loadFontRange;

  const doc = mathjax.document("", {
    InputJax: new TeX({ packages: ["base", "ams"] }),
    OutputJax: new SVG({
      // Inline every glyph as a <path>. The 'local'/'global' caches emit
      // <defs>/<use> pairs that would dangle once a label is serialized apart
      // from the document that holds the cache.
      fontCache: "none",
    }),
  });

  // Typesetting can suspend mid-render to fetch a font range; handleRetriesFor
  // is what resumes it, so the returned promise settles on a finished render.
  return (latex) =>
    mathjax.handleRetriesFor(() => doc.convert(latex, { display: true })) as Promise<Element>;
}

/**
 * A typeset run: `<g>` of glyph `<path>`s, and how much room it takes.
 *
 * Every number is in the engine's own font units ({@link UNITS_PER_EM}),
 * measured from the left baseline point the geometry has its origin at:
 * `width` runs right from it, `ascent` up and `depth` down. A caller needs them
 * to put the run anywhere but the origin — to centre it, or to sit its top edge
 * under a wall — and they are not readable off the geometry without a laid-out
 * page to measure in.
 */
export interface GlyphRun {
  readonly glyphs: Element;
  readonly width: number;
  readonly ascent: number;
  readonly depth: number;
}

/**
 * Typeset `latex` into a run of glyph `<path>`s — real geometry, never a
 * `<foreignObject>`.
 *
 * What comes back is bare geometry and its extent: no class, no colour, no
 * placement. The geometry carries a transform of its own, so a caller placing
 * it needs to wrap it rather than transform it directly. Dressing a run and
 * putting it somewhere is the caller's business; this module only knows how to
 * draw one.
 *
 * Awaiting this awaits the engine's own async start-up, so the first call is as
 * reliable as the tenth.
 */
export async function typesetLatex(latex: string): Promise<GlyphRun> {
  const typeset = await mathjaxPipeline();
  const container = await typeset(latex).catch(explainMissingRange);
  const glyphs = glyphsOf(container);
  const extent = extentOf(container);

  // Cut free of the packaging it was found in, so what the caller holds is the
  // geometry alone rather than a node still rooted in an <mjx-container>.
  glyphs.remove();
  return { glyphs, ...extent };
}

/**
 * Read the run's extent off the packaging, before that is thrown away.
 *
 * MathJax states it as the `viewBox` of the `<svg>` it wraps the geometry in —
 * the only place it is written down, the glyphs themselves being paths with no
 * bounds attached. It is `minX minY width height` in font units, with the
 * baseline at y = 0 and y pointing down, so the ascent is where the box starts
 * above the baseline and the depth is what is left below.
 */
function extentOf(container: Element): Omit<GlyphRun, "glyphs"> {
  const [, minY = 0, width = 0, height = 0] = (
    container.firstElementChild?.getAttribute("viewBox") ?? ""
  )
    .split(" ")
    .map(Number);
  return { width, ascent: -minY, depth: height + minY };
}

/**
 * Dig the glyph `<g>` out of what MathJax hands back, refusing anything that
 * isn't geometry.
 *
 * The return is an `<mjx-container>` (an HTML element) wrapping a standalone
 * `<svg>`, itself wrapping one `<g>` that flips to y-up font coordinates. Only
 * that `<g>` is geometry — the rest is packaging.
 *
 * A TeX error does not throw: MathJax renders the message as an `merror` box of
 * `<text>` sized by a browser measurement, which under jsdom is `NaN`. Letting
 * that reach a caller would put an unremovable, unexportable node into the
 * document, so a failed parse is raised as the error it is.
 *
 * A glyph MathJax has no outline for is worse, because it *looks* fine: it comes
 * back as `<text>` in whatever serif font the machine happens to have. On screen
 * that is a passable character; in an exported file it is a font reference, so
 * it renders as something else — or as nothing — on any machine without that
 * font. Refusing it is the only way the difference is ever noticed.
 */
function glyphsOf(container: Element): Element {
  const error = container.querySelector<SVGElement>("[data-mjx-error]");
  if (error) {
    throw new Error(error.dataset["mjxError"] ?? "invalid LaTeX");
  }

  // Must come after the TeX-error check: an `merror` box is made of <text> too,
  // and its own message is the more useful one.
  const unoutlined = [...container.querySelectorAll("text")];
  if (unoutlined.length > 0) {
    const characters = [...new Set(unoutlined.map((node) => node.textContent).join(""))].join("");
    throw new Error(
      `No glyph outline for ${JSON.stringify(characters)} — its font range is not bundled, ` +
        `so it would export as text rather than geometry`,
    );
  }

  const glyphs = container.firstElementChild?.firstElementChild;
  if (!glyphs) {
    throw new Error("MathJax produced no glyphs");
  }
  return glyphs;
}

/**
 * Restate MathJax's "dynamic file" rejection in terms of the diagram.
 *
 * Once a glyph range has failed to load, every later request for it rejects with
 * an internal file name — a string about MathJax's packaging, aimed at nobody
 * who is typing LaTeX. (The *first* request for that range degrades to `<text>`
 * instead, which {@link glyphsOf} catches; both roads lead to a refusal.)
 */
function explainMissingRange(failure: unknown): never {
  const message = messageOf(failure);
  const range = /dynamic file '([^']+)' failed to load/u.exec(message)?.[1];
  if (range === undefined) {
    throw failure;
  }
  throw new Error(
    `The "${range}" glyph range is not bundled, so those characters have no outlines`,
  );
}
