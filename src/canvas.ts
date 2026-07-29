// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { INK } from "./palette";

/** The namespace every element on the canvas is created in. */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** Radius of a term-dot, in canvas units. */
const DOT_RADIUS = 5;

/** `PointerEvent.button` for the left mouse button — the one that plops. */
const PRIMARY_BUTTON = 0;

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
 * Make releasing the left button over empty `canvas` plop a term-dot there.
 *
 * The dot lands where the button comes *up*, not where it went down, and every
 * check is made against that release point. A press is only a provisional
 * gesture — drag before letting go and the dot follows the pointer to wherever
 * it is finally dropped, or is refused there.
 *
 * Dots accumulate: each plop appends another `<circle>` and every earlier dot
 * stays in the DOM, so the canvas element itself is the document — nothing is
 * redrawn from a shadow model, and the live tree is what the export slice
 * later serializes. That also makes the placed dots the only record the overlap
 * check needs to consult.
 *
 * A release is refused when it lands on something already on the canvas (a dot,
 * a typeset label), or when the new dot would intersect one already placed:
 * dots never overlap.
 */
export function enablePlopping(canvas: SVGSVGElement): void {
  canvas.addEventListener("pointerup", (event: PointerEvent) => {
    if (event.button !== PRIMARY_BUTTON || event.target !== canvas) {
      return;
    }
    const { left, top } = canvas.getBoundingClientRect();
    const x = event.clientX - left;
    const y = event.clientY - top;
    if (overlapsPlacedDot(canvas, x, y)) {
      return;
    }
    canvas.append(createTermDot(x, y));
  });
}

/**
 * Whether a dot centred on (`x`, `y`) would intersect one already on `canvas`.
 *
 * Two equal circles overlap exactly when their centres are closer than two
 * radii, so touching rims are allowed and anything tighter is not. The dots are
 * read back out of the DOM because the DOM *is* the model here.
 */
function overlapsPlacedDot(canvas: SVGSVGElement, x: number, y: number): boolean {
  const placed = canvas.querySelectorAll<SVGCircleElement>("circle.term-dot");
  return [...placed].some((dot) => {
    const dx = x - Number(dot.getAttribute("cx"));
    const dy = y - Number(dot.getAttribute("cy"));
    return Math.hypot(dx, dy) < 2 * DOT_RADIUS;
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
