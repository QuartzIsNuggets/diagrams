// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { SVG_NS } from "./canvas";
import { loadFontRange } from "./font-ranges";
import { INK } from "./palette";

/**
 * MathJax's SVG output measures glyphs in thousandths of an em, so a `<g>` of
 * its paths is scaled by `em / 1000` to reach canvas units.
 */
const UNITS_PER_EM = 1000;

/** Type size of a placed label, in canvas units. */
const LABEL_EM = 24;

/** Where the first label's baseline starts, and how far each next one drops. */
const LABEL_ORIGIN_X = 40;
const LABEL_ORIGIN_Y = 60;
const LABEL_LINE_HEIGHT = 56;

/**
 * The MathJax pipeline, booted once on first use.
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

/** How long to wait for an idle moment before loading MathJax anyway. */
const PREWARM_TIMEOUT = 2000;

/**
 * Start loading MathJax once the page has drawn, so the first label does not
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
 * Typeset `latex` into a `<g>` of glyph `<path>`s — real geometry, never a
 * `<foreignObject>` wrapping HTML.
 *
 * The `<g>` comes back unpositioned, in MathJax's own font units with its
 * origin at the label's left baseline point; the caller supplies the transform
 * that scales and places it. Awaiting this awaits MathJax's own async start-up,
 * so the first call is as reliable as the tenth.
 */
export async function typesetLatex(latex: string): Promise<SVGGElement> {
  const typeset = await mathjaxPipeline();
  const container = await typeset(latex).catch(explainMissingRange);

  const label = document.createElementNS(SVG_NS, "g");
  label.classList.add("math-label");
  // MathJax paints its glyphs in `currentColor`; naming the colour here keeps
  // the label's ink with the label rather than in the page's stylesheet.
  label.setAttribute("color", INK);
  label.append(glyphsOf(container));
  return label;
}

/**
 * Dig the glyph `<g>` out of what MathJax hands back, refusing anything that
 * isn't geometry.
 *
 * The return is an `<mjx-container>` (an HTML element) wrapping a standalone
 * `<svg>`, itself wrapping one `<g>` that flips to y-up font coordinates. Only
 * that `<g>` belongs on the canvas — the rest is packaging.
 *
 * A TeX error does not throw: MathJax renders the message as an `merror` box of
 * `<text>` sized by a browser measurement, which under jsdom is `NaN`. Letting
 * that onto the canvas would put an unremovable, unexportable node into the
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
  const message = failure instanceof Error ? failure.message : String(failure);
  const range = /dynamic file '([^']+)' failed to load/u.exec(message)?.[1];
  if (range === undefined) {
    throw failure;
  }
  throw new Error(
    `The "${range}" glyph range is not bundled, so those characters have no outlines`,
  );
}

/** The LaTeX bar: a text input and the button that typesets what is in it. */
export function createLabelForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.classList.add("label-form");

  const input = document.createElement("input");
  input.type = "text";
  input.name = "latex";
  input.classList.add("label-input");
  input.placeholder = "\\Sigma_{(x:A)} P(x)";
  input.setAttribute("aria-label", "LaTeX label");

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Typeset";

  // Rejected LaTeX never reaches the canvas, so the reason has to show here or
  // the submit looks like it did nothing.
  const error = document.createElement("p");
  error.classList.add("label-error");
  error.setAttribute("role", "alert");

  form.append(input, button, error);
  return form;
}

/**
 * Make submitting `form` typeset its LaTeX onto `canvas`.
 *
 * Labels accumulate the way term-dots do, each one dropping a line below the
 * last so successive submits stay legible rather than piling up on one spot.
 */
export function enableLabelPlacing(canvas: SVGSVGElement, form: HTMLFormElement): void {
  // Placements run one at a time: each reads its row off the canvas, so two in
  // flight at once would both see the same row and land on top of each other.
  let pending: Promise<void> = Promise.resolve();

  form.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    const input = form.querySelector("input");
    const latex = input?.value.trim();
    if (!input || !latex) {
      return;
    }
    pending = pending
      .then(async () => {
        await placeLabel(canvas, latex);
        // Clearing here rather than on submit keeps the message owned by
        // whichever placement finished last: an earlier one still in flight
        // would otherwise report its failure over a later success.
        setError(form, "");
        // Only clear the input once the label is up, and only if the user has
        // not moved on to typing the next one.
        if (input.value.trim() === latex) {
          input.value = "";
        }
      })
      // A rejection must not poison the chain, or one bad label would silence
      // every submit after it. The source stays in the input to be corrected.
      .catch((failure: unknown) => {
        setError(form, failure instanceof Error ? failure.message : String(failure));
      });
  });
}

function setError(form: HTMLFormElement, message: string): void {
  const error = form.querySelector(".label-error");
  if (error) {
    error.textContent = message;
  }
}

async function placeLabel(canvas: SVGSVGElement, latex: string): Promise<void> {
  const label = await typesetLatex(latex);
  // Read the row from the canvas itself rather than a counter: the live tree is
  // the document, so this stays right however labels come and go.
  const row = canvas.querySelectorAll("g.math-label").length;
  const x = LABEL_ORIGIN_X;
  const y = LABEL_ORIGIN_Y + row * LABEL_LINE_HEIGHT;
  label.setAttribute("transform", `translate(${x},${y}) scale(${LABEL_EM / UNITS_PER_EM})`);
  canvas.append(label);
}
