// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { INK } from "./palette";

/** The namespace every element on the canvas is created in. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** Radius of a term-dot, in canvas units. */
const DOT_RADIUS = 5;

/**
 * Create the diagram canvas — the full-viewport `<svg>` "window".
 *
 * Sizing is handled by the `.canvas` CSS class (see `index.html`); this returns
 * a blank element that later slices append children to (term-dots, typeset
 * labels). It is deliberately a pure factory so it can be exercised in isolation.
 */
export function createCanvas(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("canvas");
  return svg;
}

/**
 * Make clicks on empty `canvas` plop a term-dot at the click point.
 *
 * Dots accumulate: each click appends another `<circle>` and every earlier dot
 * stays in the DOM, so the canvas element itself is the document — nothing is
 * redrawn from a shadow model, and the live tree is what the export slice
 * later serializes.
 *
 * Clicks that land on something already on the canvas (a dot, a typeset label)
 * are ignored: only bare canvas plops.
 */
export function enablePlopping(canvas: SVGSVGElement): void {
  canvas.addEventListener("click", (event: MouseEvent) => {
    if (event.target !== canvas) {
      return;
    }
    const { left, top } = canvas.getBoundingClientRect();
    canvas.append(createTermDot(event.clientX - left, event.clientY - top));
  });
}

/** A term-dot: the `<circle>` standing for a term, centred on (`x`, `y`). */
function createTermDot(x: number, y: number): SVGCircleElement {
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.classList.add("term-dot");
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", String(DOT_RADIUS));
  dot.setAttribute("fill", INK);
  return dot;
}
