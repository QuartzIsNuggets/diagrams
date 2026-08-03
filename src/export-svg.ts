// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import type { Diagram } from "./diagram";
import { messageOf } from "./failure";
import { drawDocument } from "./render-svg";

import { writeFile } from "./writer";

/** What the exported diagram is called, until the user says otherwise. */
const EXPORT_FILENAME = "diagram.svg";

/** What it is, for whoever opens it: a drawing, not text that happens to be XML. */
const SVG_MEDIA_TYPE = "image/svg+xml;charset=utf-8";

/**
 * The bytes `diagram` exports as: a standalone SVG document drawing it.
 *
 * An export is a drawing of the diagram rather than a copy of the screen. The
 * SVG backend is asked for a document of its own, framed by the ink in it, so
 * the same diagram comes out the same file at every window size and no laid-out
 * page is needed to make one. That the diagram is what an export is emitted
 * from is the seam a second backend joins at: what changes for TikZ is which one
 * is asked, not how a file leaves.
 *
 * Everything the marks need to render travels with them — glyphs are inline
 * `<path>` geometry and colours are presentation attributes — so the result
 * stands on its own, with no reference back to this page's stylesheet, fonts,
 * or `<defs>`.
 *
 * Every label is expected already set: drawing is synchronous, so a source the
 * backend has never typeset exports as a mark with no name rather than as a
 * failure — the same thing it looks like on screen. A caller that did not put
 * the diagram there by gesture owes it a `setLabelsOf` first, which is also the
 * one thing that reports a source that will not set at all.
 */
export function serializeDiagram(diagram: Diagram): string {
  // Not `outerHTML`: that serializes by HTML rules, which leave the SVG
  // namespace to be inferred from the surrounding document — there isn't one
  // here. XMLSerializer declares it on the root, because the element genuinely
  // is in it, and that declaration is what makes the file parseable alone.
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(drawDocument(diagram))}\n`;
}

/**
 * The export affordance — the button that exports whatever `diagramNow` answers
 * with, and the region that reports a write the filesystem refused — wired and
 * ready to append.
 *
 * It is asked for the diagram at the moment the button is pressed rather than
 * handed one: a diagram is a value, so the one held when this was built is the
 * one the editor has since moved on from.
 *
 * `whileNaming` is the one thing it is told about the editing going on behind
 * it, and it is required: no diagram leaves the editor half-made, so a caller
 * who could omit it would get a control that exports one. It is handed in rather
 * than reached for, so the coupling is a wire in the page's own wiring and this
 * module still knows nothing of bars.
 *
 * It comes back already listening rather than as an inert element a caller has
 * to remember to enable: the button exists for this one action, so there is no
 * useful moment between the two and nothing for a caller to get in the wrong
 * order. Where it goes on the page is still theirs to decide.
 */
export function createExportControls(
  diagramNow: () => Diagram,
  whileNaming: (watch: (asking: boolean) => void) => void,
): HTMLDivElement {
  const controls = document.createElement("div");
  controls.classList.add("export-controls");

  // Built on both surfaces, though only the app can fill it: a hand-off cannot
  // fail. Skipping it in a browser tab would mean reading the surface here, and
  // `writer.ts` is where that read is kept — bought, on the web, for an empty
  // `<p>`.
  const error = document.createElement("p");
  error.classList.add("export-error");
  error.setAttribute("role", "alert");

  const button = document.createElement("button");
  // Explicitly not a submit button: it sits outside the LaTeX form, and the
  // default type would make it one wherever it is later moved.
  button.type = "button";
  button.classList.add("export-button");
  button.textContent = "Export SVG";

  // The message goes before the button, not after it: the affordance is
  // anchored to the bottom of the viewport, so it grows upward and the button
  // stays under the cursor that just pressed it.
  controls.append(error, button);
  enableExporting(diagramNow, button, error);

  // `disabled` and not a rule of our own: it is the one state that stops a press
  // *and* a keystroke *and* has a look the stylesheet only has to dim. The
  // refusal region is left alone — this stops an export from starting, and the
  // region is where one that failed says so.
  whileNaming((asking) => {
    button.disabled = asking;
  });
  return controls;
}

/**
 * Make pressing `button` emit the diagram as a standalone `.svg` file, and
 * report into `error` when the filesystem will not take it.
 *
 * Where those bytes end up is `writeFile`'s business and differs by surface, so
 * a completed write is dropped rather than reported: an export is one-way, and
 * there is nothing here to remember a path for. A refusal is not dropped: it
 * arrives as a rejection rather than as an outcome, which is easy to swallow
 * and which no console in the app window is there to receive.
 *
 * A message stands for the *last* attempt, so every outcome that is not a
 * refusal empties it — including a cancelled dialog, which failed at nothing.
 */
function enableExporting(
  diagramNow: () => Diagram,
  button: HTMLButtonElement,
  error: HTMLParagraphElement,
): void {
  button.addEventListener("click", () => {
    writeFile({
      contents: serializeDiagram(diagramNow()),
      filename: EXPORT_FILENAME,
      mediaType: SVG_MEDIA_TYPE,
    })
      .then(() => {
        error.textContent = "";
      })
      // What the filesystem said, after what it refused to do: a refusal
      // describes neither on its own, and it comes from a plugin boundary
      // rather than from anything here.
      .catch((failure: unknown) => {
        error.textContent = `The export could not be written: ${messageOf(failure)}`;
      });
  });
}
