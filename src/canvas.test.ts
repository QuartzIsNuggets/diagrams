// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it } from "vitest";

import { createCanvas, enablePlopping, SVG_NS } from "./canvas";

/** Press the primary button at viewport coordinates, the way a mouse would. */
function pressAt(target: Element, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent("pointerdown", { clientX, clientY, button: 0, bubbles: true }),
  );
}

/** Release the primary button at viewport coordinates, the way a mouse would. */
function releaseAt(target: Element, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent("pointerup", { clientX, clientY, button: 0, bubbles: true }),
  );
}

/** A full press-and-release in one spot: an ordinary click. */
function clickAt(target: Element, clientX: number, clientY: number): void {
  pressAt(target, clientX, clientY);
  releaseAt(target, clientX, clientY);
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

/** Plop a dot and hand it back, so a test can aim a gesture at it. */
function plopDotAt(canvas: SVGSVGElement, clientX: number, clientY: number): SVGCircleElement {
  clickAt(canvas, clientX, clientY);
  const dot = dotsOf(canvas).at(-1);
  if (!dot) {
    throw new Error(`expected a dot to be plopped at (${String(clientX)}, ${String(clientY)})`);
  }
  return dot;
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

describe("when the dot is placed", () => {
  it("waits for the release — pressing alone plops nothing", () => {
    pressAt(canvas, 40, 40);

    expect(dotsOf(canvas)).toHaveLength(0);
  });

  it("uses the release point, not the press point", () => {
    pressAt(canvas, 40, 40);
    releaseAt(canvas, 200, 150);

    expect(centresOf(canvas)).toEqual([["200", "150"]]);
  });

  it("ignores a release of a non-primary button", () => {
    canvas.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 40, clientY: 40, button: 2, bubbles: true }),
    );

    expect(dotsOf(canvas)).toHaveLength(0);
  });
});

describe("releasing over something already on the canvas", () => {
  it("plops nothing on top of a typeset label", () => {
    const label = document.createElementNS(SVG_NS, "g");
    label.classList.add("math-label");
    canvas.append(label);

    releaseAt(label, 200, 150);

    expect(dotsOf(canvas)).toHaveLength(0);
  });

  it("plops nothing when a press on bare canvas is dragged onto a label and released there", () => {
    const label = document.createElementNS(SVG_NS, "g");
    canvas.append(label);

    pressAt(canvas, 20, 20);
    releaseAt(label, 200, 150);

    expect(dotsOf(canvas)).toHaveLength(0);
  });
});

describe("keeping dots from overlapping", () => {
  it("plops nothing when the release lands on a dot already on the canvas", () => {
    const dot = plopDotAt(canvas, 40, 40);

    releaseAt(dot, 40, 40);

    expect(dotsOf(canvas)).toHaveLength(1);
  });

  it("plops nothing when a press on bare canvas is dragged onto a dot and released there", () => {
    const dot = plopDotAt(canvas, 40, 40);

    pressAt(canvas, 200, 200);
    releaseAt(dot, 42, 41);

    expect(dotsOf(canvas)).toHaveLength(1);
  });

  it("plops nothing when the release is on bare canvas but close enough to overlap a dot", () => {
    plopDotAt(canvas, 40, 40);

    // 7 units away: outside the existing circle, but the two would still
    // intersect, which is exactly what the constraint forbids.
    clickAt(canvas, 47, 40);

    expect(centresOf(canvas)).toEqual([["40", "40"]]);
  });

  it("plops when the release is just clear of every dot", () => {
    plopDotAt(canvas, 40, 40);

    // Two radii apart: the circles touch at a point without overlapping.
    clickAt(canvas, 50, 40);

    expect(centresOf(canvas)).toEqual([
      ["40", "40"],
      ["50", "40"],
    ]);
  });
});

describe("what the overlap check is measured against", () => {
  it("checks the release against every dot, not just the last one", () => {
    plopDotAt(canvas, 40, 40);
    plopDotAt(canvas, 300, 200);

    clickAt(canvas, 44, 43);

    expect(dotsOf(canvas)).toHaveLength(2);
  });

  it("measures overlap in canvas units, not viewport units", () => {
    offsetCanvasBy(canvas, 30, 12);
    plopDotAt(canvas, 120, 45);

    // (123, 47) in viewport space is 3 units from the dot's canvas centre —
    // an overlap that only shows up once the offset is subtracted.
    clickAt(canvas, 123, 47);

    expect(dotsOf(canvas)).toHaveLength(1);
  });
});
