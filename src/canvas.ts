// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

/** The namespace every element on the canvas is created in. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create the diagram canvas — the full-viewport `<svg>` "window".
 *
 * Sizing is handled by the `.canvas` CSS class (see `index.html`); this returns
 * a blank element, and it holds nothing of its own: the render backend draws the
 * diagram into it and never reads it back. It is deliberately a pure factory so
 * it can be exercised in isolation.
 */
export function createCanvas(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("canvas");
  return svg;
}
