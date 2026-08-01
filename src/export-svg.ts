// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { writeFile } from "./writer";

/** What the exported diagram is called, until the user says otherwise. */
const EXPORT_FILENAME = "diagram.svg";

/** What it is, for whoever opens it: a drawing, not text that happens to be XML. */
const SVG_MEDIA_TYPE = "image/svg+xml;charset=utf-8";

/**
 * Serialize `canvas` into a standalone SVG document.
 *
 * The live canvas is sized by CSS and carries no `width`, `height` or
 * `viewBox`, so serializing it as-is would give a document with no dimensions
 * at all — legal XML that renders as nothing. The three are added here, taken
 * from the canvas's rendered box: dots are already placed in coordinates
 * relative to that box (see `enablePlopping`), so `0 0 width height` is exactly
 * the frame the whole diagram is drawn in and the export is 1:1 with the
 * screen.
 *
 * Everything the marks need to render travels with them — glyphs are inline
 * `<path>` geometry and colours are presentation attributes — so the result
 * stands on its own, with no reference back to this page's stylesheet, fonts,
 * or `<defs>`.
 */
export function serializeCanvas(canvas: SVGSVGElement): string {
  const { width, height } = canvas.getBoundingClientRect();

  // A clone, so framing the export never disturbs what is on screen.
  const standalone = canvas.cloneNode(true) as SVGSVGElement;
  standalone.setAttribute("width", String(width));
  standalone.setAttribute("height", String(height));
  standalone.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);

  // Not `outerHTML`: that serializes by HTML rules, which leave the SVG
  // namespace to be inferred from the surrounding document — there isn't one
  // here. XMLSerializer declares it on the root, because the element genuinely
  // is in it, and that declaration is what makes the file parseable alone.
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(standalone)}\n`;
}

/**
 * The button that exports `canvas`, wired and ready to append.
 *
 * It comes back already listening rather than as an inert element a caller has
 * to remember to enable: the button exists for this one action, so there is no
 * useful moment between the two and nothing for a caller to get in the wrong
 * order. Where it goes on the page is still theirs to decide.
 */
export function createExportButton(canvas: SVGSVGElement): HTMLButtonElement {
  const button = document.createElement("button");
  // Explicitly not a submit button: it sits outside the LaTeX form, and the
  // default type would make it one wherever it is later moved.
  button.type = "button";
  button.classList.add("export-button");
  button.textContent = "Export SVG";
  enableExporting(canvas, button);
  return button;
}

/**
 * Make pressing `button` emit `canvas` as a standalone `.svg` file.
 *
 * Where those bytes end up is `writeFile`'s business and differs by surface, so
 * what comes back is dropped rather than reported: an export is one-way, and
 * there is nothing here to remember a path for.
 */
function enableExporting(canvas: SVGSVGElement, button: HTMLButtonElement): void {
  button.addEventListener("click", () => {
    void writeFile({
      contents: serializeCanvas(canvas),
      filename: EXPORT_FILENAME,
      mediaType: SVG_MEDIA_TYPE,
    });
  });
}
