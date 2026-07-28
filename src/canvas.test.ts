// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it } from "vitest";

import { createCanvas, enablePlopping } from "./canvas";

/** Click at viewport coordinates, the way a mouse would. */
function clickAt(target: Element, clientX: number, clientY: number): void {
  target.dispatchEvent(new MouseEvent("click", { clientX, clientY, bubbles: true }));
}

function dotsOf(canvas: SVGSVGElement): SVGCircleElement[] {
  return [...canvas.querySelectorAll("circle")];
}

function centresOf(canvas: SVGSVGElement): (string | null)[][] {
  return dotsOf(canvas).map((dot) => [dot.getAttribute("cx"), dot.getAttribute("cy")]);
}

/**
 * Place the canvas at a viewport offset.
 *
 * jsdom has no layout — every `getBoundingClientRect()` is all zeros — so
 * without this a click's client-to-canvas conversion would be untested
 * identity arithmetic.
 */
function offsetCanvasBy(canvas: SVGSVGElement, left: number, top: number): void {
  canvas.getBoundingClientRect = (): DOMRect => new DOMRect(left, top, 800, 600);
}

let canvas: SVGSVGElement;

beforeEach(() => {
  canvas = createCanvas();
  enablePlopping(canvas);
  document.body.append(canvas);
});

describe("plopping term-dots", () => {
  it("places a circle centred on the click point", () => {
    clickAt(canvas, 120, 45);

    const dots = dotsOf(canvas);
    expect(dots).toHaveLength(1);
    expect(centresOf(canvas)).toEqual([["120", "45"]]);
    expect(Number(dots[0]?.getAttribute("r"))).toBeGreaterThan(0);
  });

  it("centres the dot on the click point even when the canvas is offset in the viewport", () => {
    offsetCanvasBy(canvas, 30, 12);

    clickAt(canvas, 120, 45);

    expect(centresOf(canvas)).toEqual([["90", "33"]]);
  });

  it("accumulates a dot per click, keeping the earlier ones", () => {
    clickAt(canvas, 10, 10);
    clickAt(canvas, 20, 30);
    clickAt(canvas, 300, 200);

    expect(centresOf(canvas)).toEqual([
      ["10", "10"],
      ["20", "30"],
      ["300", "200"],
    ]);
  });

  it("starts empty until something is clicked", () => {
    expect(dotsOf(canvas)).toHaveLength(0);
  });
});

describe("the plopped term-dot", () => {
  it("is a real SVG child of the canvas", () => {
    clickAt(canvas, 5, 5);

    const [dot] = dotsOf(canvas);
    expect(dot?.parentNode).toBe(canvas);
    expect(dot?.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });

  it("carries its styling as presentation attributes, so a serialized canvas keeps its look", () => {
    clickAt(canvas, 5, 5);

    const [dot] = dotsOf(canvas);
    expect(dot?.getAttribute("fill")).toBeTruthy();
    expect(dot?.classList.contains("term-dot")).toBe(true);
  });
});

describe("clicking something already on the canvas", () => {
  it("plops nothing — only bare canvas plops", () => {
    clickAt(canvas, 40, 40);
    const [dot] = dotsOf(canvas);
    if (!dot) {
      throw new Error("expected the first click to plop a dot");
    }

    clickAt(dot, 40, 40);

    expect(dotsOf(canvas)).toHaveLength(1);
  });
});
