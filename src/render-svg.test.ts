// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The backend seam: where pixels stop. What is tested here is everything that
// needs a document to be true — the conversion, the flip, and the rules a
// press-drag-release goes by. The geometry those rules hand on is the diagram's
// own and is tested in diagram.test.ts, with no DOM at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas, SVG_NS } from "./canvas";
import type { Diagram, Extent, Point } from "./diagram";
import { addBox, addDot, DOT_SEPARATION, EMPTY_DIAGRAM } from "./diagram";
import type { Started } from "./render-svg";
import { clearChrome, enableDragging, measureBox, renderDiagram, toPagePoint } from "./render-svg";

let canvas: SVGSVGElement;

/**
 * Place the canvas at a viewport offset.
 *
 * jsdom has no layout — every `getBoundingClientRect()` is all zeros — so
 * without this the pointer conversion would be untested identity arithmetic.
 */
function offsetCanvasBy(left: number, top: number): void {
  canvas.getBoundingClientRect = (): DOMRect => new DOMRect(left, top, 800, 600);
}

function pressAt(clientX: number, clientY: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerdown", { clientX, clientY, button: 0, bubbles: true }),
  );
}

function moveTo(clientX: number, clientY: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointermove", { clientX, clientY, button: 0, bubbles: true }),
  );
}

function releaseAt(clientX: number, clientY: number): void {
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { clientX, clientY, button: 0, bubbles: true }),
  );
}

function drawnBoxes(): SVGRectElement[] {
  return [...canvas.querySelectorAll<SVGRectElement>("g.diagram rect")];
}

function cornerOf(rect: Element | null | undefined): (string | null)[] {
  return ["x", "y", "width", "height"].map((name) => rect?.getAttribute(name) ?? null);
}

function drawnDots(): SVGCircleElement[] {
  return [...canvas.querySelectorAll<SVGCircleElement>("g.diagram circle.term-dot")];
}

/** A diagram holding one box, the way a landed gesture would have left it. */
function withBox(extent: Extent, source = "A"): Diagram {
  return addBox(EMPTY_DIAGRAM, { source, ...extent });
}

/** That box, with a dot at each of `places` — a gesture per dot. */
function withDots(extent: Extent, ...places: readonly Point[]): Diagram {
  return places.reduce<Diagram>((sofar, at) => {
    const next = addDot(sofar, at);
    if (typeof next !== "string") {
      return next;
    }
    throw new Error(`the diagram refused a dot: ${next}`);
  }, withBox(extent));
}

/**
 * Wire the canvas for dragging, and hand back the rectangles that land on it.
 *
 * The conversion and the provisional rectangle are the backend's own business,
 * so they are reached the way the shell reaches them — through a gesture — and
 * what lands is the only thing that crosses out in diagram units.
 *
 * A gesture started here has to be let go of before the test ends: the app wires
 * one canvas for its lifetime, so watching the window costs it nothing, but a
 * suite wires one per test and a drag left half-finished claims the *next*
 * test's release.
 */
function draggingLands(starts: (at: Point) => Started = () => "rectangle"): Extent[] {
  const landed: Extent[] = [];
  enableDragging(canvas, starts, (drag) => landed.push(drag));
  return landed;
}

beforeEach(() => {
  canvas = createCanvas();
  document.body.replaceChildren(canvas);
});

describe("where a pointer is, in diagram units", () => {
  it("takes the canvas's own corner as the origin, wherever it sits on the page", () => {
    offsetCanvasBy(30, 12);
    const landed = draggingLands();

    pressAt(120, 45);
    releaseAt(120, 45);

    expect(landed[0]?.x).toBe(90);
  });

  it("points y up, so a press further down the page is further down the plane", () => {
    const landed = draggingLands();

    pressAt(40, 10);
    releaseAt(40, 10);
    pressAt(40, 200);
    releaseAt(40, 200);

    expect(landed.map((at) => at.y)).toEqual([-10, -200]);
  });

  it("crosses back to the page for chrome that is not drawn on the canvas", () => {
    offsetCanvasBy(30, 12);
    const at: Point = { x: 90, y: -33 };

    expect(toPagePoint(canvas, at)).toEqual({ left: 120, top: 45 });
  });
});

describe("drawing a diagram", () => {
  it("flips once, at its own root, and nowhere below it", () => {
    renderDiagram(canvas, withBox({ x: 0, y: -50, w: 40, h: 20 }));

    const root = canvas.querySelector("g.diagram");
    expect(root?.getAttribute("transform")).toBe("scale(1,-1)");
    expect(cornerOf(drawnBoxes()[0])).toEqual(["-20", "-60", "40", "20"]);
  });

  it("draws a box because the diagram holds one, from the extent it holds", () => {
    renderDiagram(canvas, withBox({ x: 100, y: -60, w: 40, h: 24 }));

    expect(cornerOf(drawnBoxes()[0])).toEqual(["80", "-72", "40", "24"]);
  });

  it("draws nothing at all for a diagram with nothing in it", () => {
    renderDiagram(canvas, EMPTY_DIAGRAM);

    expect(drawnBoxes()).toHaveLength(0);
    expect(canvas.querySelector("g.diagram")).not.toBeNull();
  });

  it("carries its ink as presentation attributes, so a serialized canvas keeps its look", () => {
    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 40, h: 20 }));

    expect(drawnBoxes()[0]?.getAttribute("stroke")).toBeTruthy();
    expect(drawnBoxes()[0]?.getAttribute("fill")).toBe("none");
  });

  it("is ink and never a pointer target — what a press lands in is the diagram's to answer", () => {
    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 40, h: 20 }));

    expect(canvas.querySelector("g.diagram")?.getAttribute("pointer-events")).toBe("none");
  });
});

describe("redrawing", () => {
  it("replaces what it drew before rather than accumulating", () => {
    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 40, h: 20 }));
    renderDiagram(canvas, withBox({ x: 200, y: -100, w: 40, h: 20 }));

    expect(canvas.querySelectorAll("g.diagram")).toHaveLength(1);
    expect(cornerOf(drawnBoxes()[0])).toEqual(["180", "-110", "40", "20"]);
  });

  it("leaves marks the canvas holds for other reasons alone", () => {
    const dot = document.createElementNS(SVG_NS, "circle");
    canvas.append(dot);

    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 40, h: 20 }));
    renderDiagram(canvas, EMPTY_DIAGRAM);

    expect(dot.parentNode).toBe(canvas);
  });

  it("draws under them, so what is over the diagram stays over it", () => {
    canvas.append(document.createElementNS(SVG_NS, "circle"));

    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 40, h: 20 }));

    expect(canvas.firstElementChild?.classList.contains("diagram")).toBe(true);
  });
});

describe("a box's label", () => {
  it("is drawn inside its walls, from the source the box carries", async () => {
    await measureBox("A");
    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 200, h: 100 }));

    const label = canvas.querySelector("g.box-label");
    expect(label?.querySelectorAll("path").length).toBeGreaterThan(0);
    // Turned back the right way up: glyph geometry expects a y-down frame.
    expect(label?.getAttribute("transform")).toMatch(/^translate\(.+\) scale\([\d.]+,-[\d.]+\)$/u);
  });

  it("sits at the slot the box names", async () => {
    await measureBox("A");
    const top = withBox({ x: 0, y: 0, w: 200, h: 100 });
    const bottom: Diagram = {
      ...top,
      boxes: top.boxes.map((box) => ({ ...box, labelSlot: "bottom-left" as const })),
    };

    renderDiagram(canvas, top);
    const centred = canvas.querySelector("g.box-label")?.getAttribute("transform");
    renderDiagram(canvas, bottom);
    const cornered = canvas.querySelector("g.box-label")?.getAttribute("transform");

    expect(centred).not.toBe(cornered);
  });

  it("is drawn in the same ink as the walls, a box being one mark and not two", async () => {
    await measureBox("A");
    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 200, h: 100 }));

    const walls = canvas.querySelector("g.box > rect");
    const label = canvas.querySelector("g.box-label");
    expect(label?.getAttribute("color")).toBe(walls?.getAttribute("stroke"));
  });

  it("is left off a box whose source has never been typeset", () => {
    renderDiagram(canvas, withBox({ x: 0, y: 0, w: 200, h: 100 }, "\\notatypesetsource"));

    expect(canvas.querySelector("g.box-label")).toBeNull();
    expect(drawnBoxes()).toHaveLength(1);
  });
});

describe("a term-dot", () => {
  it("is drawn where the diagram puts it, its place being relative to its box", () => {
    renderDiagram(canvas, withDots({ x: 100, y: -60, w: 80, h: 40 }, { x: 120, y: -50 }));

    const [dot] = drawnDots();
    expect([dot?.getAttribute("cx"), dot?.getAttribute("cy")]).toEqual(["120", "-50"]);
    expect(dot?.getAttribute("fill")).toBeTruthy();
  });

  it("is drawn in its box's group, so the drawing groups what the diagram groups", () => {
    renderDiagram(canvas, withDots({ x: 0, y: 0, w: 80, h: 40 }, { x: 10, y: 10 }));

    expect(drawnDots()[0]?.closest("g.box")).not.toBeNull();
  });

  it("is small enough that two the model calls clear of each other are", () => {
    renderDiagram(canvas, withDots({ x: 0, y: 0, w: 80, h: 40 }, { x: 0, y: 0 }));

    // The model owns how far apart two dots stand and names no size; this is
    // the whole of what a backend owes that number.
    expect(2 * Number(drawnDots()[0]?.getAttribute("r"))).toBeLessThanOrEqual(DOT_SEPARATION);
  });
});

describe("the extent a source needs", () => {
  it("is bigger than the run, the label being given room inside the walls", async () => {
    const small = await measureBox("x");
    const large = await measureBox("\\Sigma_{(x:A)} P(x)");

    expect(small.w).toBeGreaterThan(0);
    expect(small.h).toBeGreaterThan(0);
    expect(large.w).toBeGreaterThan(small.w);
  });

  it("refuses a source this backend cannot draw, rather than measuring nothing", async () => {
    await expect(measureBox("\\notacontrolsequence{x}")).rejects.toThrow(
      /undefined control sequence/iu,
    );
  });
});

describe("the rectangle a press-drag-release hands on", () => {
  it("runs between the press and the release, in diagram units", () => {
    offsetCanvasBy(30, 12);
    const landed = draggingLands();

    pressAt(50, 32);
    releaseAt(150, 132);

    expect(landed).toEqual([{ x: 70, y: -70, w: 100, h: 100 }]);
  });

  it("is the same rectangle whichever way the drag ran", () => {
    const landed = draggingLands();

    pressAt(150, 130);
    releaseAt(50, 30);

    expect(landed).toEqual([{ x: 100, y: -80, w: 100, h: 100 }]);
  });

  it("needs no threshold: a click is a drag of no size", () => {
    const landed = draggingLands();

    pressAt(40, 40);
    releaseAt(40, 40);

    expect(landed).toEqual([{ x: 40, y: -40, w: 0, h: 0 }]);
  });
});

describe("a gesture that shows nothing while it runs", () => {
  /** Wire the canvas for a gesture drawing no chrome, and collect where it lands. */
  function releasesAt(): Point[] {
    const landed: Point[] = [];
    enableDragging(
      canvas,
      () => "nothing",
      (_drag, at) => landed.push(at),
    );
    return landed;
  }

  it("draws no rectangle, which would say a box was coming", () => {
    releasesAt();

    pressAt(40, 40);
    moveTo(140, 90);

    expect(canvas.querySelector("g.chrome")).toBeNull();
    releaseAt(140, 90);
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });

  it("still hands on where it was let go of, which is all a dot needs", () => {
    const landed = releasesAt();

    pressAt(40, 40);
    releaseAt(140, 90);

    expect(landed).toEqual([{ x: 140, y: -90 }]);
  });
});

describe("what never lands a rectangle", () => {
  it("a press on its own, however far it is dragged", () => {
    const landed = draggingLands();

    pressAt(40, 40);
    moveTo(90, 90);

    expect(landed).toEqual([]);
    // Let it go, so no half-finished gesture is left watching the window.
    releaseAt(90, 90);
  });

  it("a press of a non-primary button", () => {
    const landed = draggingLands();

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 40, clientY: 40, button: 2, bubbles: true }),
    );
    releaseAt(90, 90);

    expect(landed).toEqual([]);
  });

  it("a press the diagram does not allow one to start from", () => {
    const landed = draggingLands(() => "no-gesture");

    pressAt(40, 40);
    releaseAt(90, 90);

    expect(landed).toEqual([]);
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });
});

describe("who a release belongs to", () => {
  let other: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    other = vi.fn();
    enableDragging(canvas, () => "rectangle", vi.fn());
    canvas.addEventListener("pointerup", other);
  });

  it("is the gesture the press started, and nothing else listening for one", () => {
    pressAt(40, 40);
    releaseAt(90, 90);

    expect(other).not.toHaveBeenCalled();
  });

  it("is whatever else was listening, where no press of its own started one", () => {
    releaseAt(90, 90);

    expect(other).toHaveBeenCalledOnce();
  });
});

describe("the rectangle a box is drawn in", () => {
  it("follows the drag, and is chrome rather than diagram", () => {
    draggingLands();

    pressAt(40, 40);
    moveTo(140, 90);

    const chrome = canvas.querySelector("g.chrome");
    expect(chrome?.getAttribute("pointer-events")).toBe("none");
    expect(cornerOf(chrome?.querySelector("rect"))).toEqual(["40", "-90", "100", "50"]);
    expect(drawnBoxes()).toHaveLength(0);
    releaseAt(140, 90);
  });

  it("stands where the gesture left it, until whatever took it up takes it down", () => {
    draggingLands();

    pressAt(40, 40);
    releaseAt(140, 90);
    expect(cornerOf(canvas.querySelector("g.chrome > rect"))).toEqual(["40", "-90", "100", "50"]);

    clearChrome(canvas);

    expect(canvas.querySelector("g.chrome")).toBeNull();
  });
});
