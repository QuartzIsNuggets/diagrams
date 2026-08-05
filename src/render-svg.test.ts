// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The backend seam: where pixels stop. What is tested here is everything that
// needs a document to be true — the conversion, the flip, and the ink. The
// geometry it draws from is the diagram's own and is tested in diagram.test.ts
// with no DOM at all; what a press means is the gesture's, and is tested in
// gesture.test.ts with no canvas.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas, SVG_NS } from "./canvas";
import type { Diagram, DotId, DotSide, Extent, Point } from "./diagram";
import { addBox, addDot, DOT_SEPARATION, EMPTY_DIAGRAM, labelDot } from "./diagram";
import {
  enableDragging,
  measureBox,
  renderDiagram,
  setLabelsOf,
  toPagePoint,
  vetSource,
} from "./render-svg";
import { typesetLatex } from "./typesetting";

// The real engine, counted rather than replaced: how often a source is set is
// the backend's own claim, and it is only worth asserting against the thing
// that actually sets one. `typesetting.test.ts` is untouched by this.
vi.mock("./typesetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./typesetting")>();
  return { ...actual, typesetLatex: vi.fn(actual.typesetLatex) };
});

let canvas: SVGSVGElement;

/** How many times the engine has been asked for `source`. */
function timesSet(source: string): number {
  return vi.mocked(typesetLatex).mock.calls.filter(([latex]) => latex === source).length;
}

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

/** A dot placed at `at`, or a failure saying the diagram refused it. */
function placedAt(diagram: Diagram, at: Point): { diagram: Diagram; dot: DotId } {
  const next = addDot(diagram, at);
  if (typeof next !== "string") {
    return next;
  }
  throw new Error(`the diagram refused a dot: ${next}`);
}

/** That box, with a dot at each of `places` — a gesture per dot. */
function withDots(extent: Extent, ...places: readonly Point[]): Diagram {
  return places.reduce<Diagram>((sofar, at) => placedAt(sofar, at).diagram, withBox(extent));
}

/** That box, with one dot at `at` labelled `source` on the side named. */
function withNamedDot(extent: Extent, at: Point, source: string, side: DotSide = "above"): Diagram {
  const { diagram, dot } = placedAt(withBox(extent), at);
  const named = labelDot(diagram, dot, source);
  // `above` is the side the model gives a new label; the other three are
  // written in here, no gesture putting a label on one of them yet.
  return { ...named, dots: named.dots.map((one) => ({ ...one, source, labelSide: side })) };
}

/**
 * Wire the canvas for dragging, and hand back the rectangles that land on it.
 *
 * The conversion and the provisional rectangle are the backend's own business,
 * so they are reached the way the shell reaches them — through a gesture — and
 * what lands is the only thing that crosses out in diagram units.
 */
function draggingLands(): Extent[] {
  const landed: Extent[] = [];
  enableDragging(
    canvas,
    () => "rectangle",
    // Nothing to name, so the naming is over as soon as it is asked for — and
    // the rectangle comes down a turn after the release rather than standing.
    (drag) => {
      landed.push(drag);
      return Promise.resolve();
    },
  );
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

/** Where a label was put: the origin its transform translates its glyphs to. */
function originOf(label: Element | null | undefined): Point {
  const [x = NaN, y = NaN] = /translate\(([-\d.]+),([-\d.]+)\)/u
    .exec(label?.getAttribute("transform") ?? "")
    ?.slice(1)
    .map(Number) ?? [NaN, NaN];
  return { x, y };
}

/** Draw a box holding one dot named `source` on `side`, and place the label. */
async function drawNamedDot(source: string, side?: DotSide): Promise<Point> {
  const diagram = withNamedDot({ x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0 }, source, side);
  await setLabelsOf(diagram);
  renderDiagram(canvas, diagram);
  return originOf(canvas.querySelector("g.dot-label"));
}

describe("a term-dot's label", () => {
  it("is drawn from the source the dot carries, in the dot's own ink", async () => {
    await drawNamedDot("x");

    const label = canvas.querySelector("g.dot-label");
    expect(label?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(label?.getAttribute("color")).toBe(drawnDots()[0]?.getAttribute("fill"));
    // Turned back the right way up, as a box's label is: glyph geometry
    // expects the y-down frame it was made in.
    expect(label?.getAttribute("transform")).toMatch(/^translate\(.+\) scale\([\d.]+,-[\d.]+\)$/u);
  });

  it("sits on the side the dot names, all four being answers of their own", async () => {
    const sides = ["left", "right", "above", "below"] as const;
    const origins = [];
    for (const side of sides) {
      origins.push(await drawNamedDot("y", side));
    }
    const [left, right, above, below] = origins;

    expect(new Set(origins.map(({ x, y }) => `${String(x)},${String(y)}`)).size).toBe(4);
    // Beside the dot: one run's width to its left, or straight off its right.
    expect(left?.x).toBeLessThan(0);
    expect(right?.x).toBeGreaterThan(0);
    expect(left?.y).toBeCloseTo(right?.y ?? NaN);
    // Above and below: centred across the dot, clear of it either way.
    expect(above?.y).toBeGreaterThan(0);
    expect(below?.y).toBeLessThan(0);
    expect(above?.x).toBeCloseTo(below?.x ?? NaN);
  });

  it("stands clear of the dot's own ink, rather than of the point it marks", async () => {
    const beside = await drawNamedDot("q", "right");

    expect(beside.x).toBeGreaterThan(Number(drawnDots()[0]?.getAttribute("r")));
  });
});

describe("a dot with no label to draw", () => {
  it("is one that was never named, and it still draws", () => {
    renderDiagram(canvas, withDots({ x: 0, y: 0, w: 80, h: 40 }, { x: 10, y: 10 }));

    expect(canvas.querySelector("g.dot-label")).toBeNull();
    expect(drawnDots()).toHaveLength(1);
  });

  it("is one whose source has never been set, and it still draws too", () => {
    renderDiagram(canvas, withNamedDot({ x: 0, y: 0, w: 80, h: 40 }, { x: 0, y: 0 }, "\\neverset"));

    expect(canvas.querySelector("g.dot-label")).toBeNull();
    expect(drawnDots()).toHaveLength(1);
  });
});

describe("setting the sources a diagram brings", () => {
  it("sets what has never been set, so the next drawing has it to draw", async () => {
    const diagram = withNamedDot({ x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0 }, "w");

    renderDiagram(canvas, diagram);
    expect(canvas.querySelector("g.dot-label")).toBeNull();
    expect(await setLabelsOf(diagram)).toEqual([]);
    renderDiagram(canvas, diagram);

    expect(canvas.querySelectorAll("g.dot-label")).toHaveLength(1);
  });
});

describe("a source that will not set", () => {
  it("is named, and what the typesetter said of it with it", async () => {
    const bad = "\\notacontrolsequence{u}";
    const diagram = withNamedDot({ x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0 }, bad);

    const unset = await setLabelsOf(diagram);

    expect(unset).toHaveLength(1);
    expect(unset[0]?.source).toBe(bad);
    expect(unset[0]?.why).toMatch(/undefined control sequence/iu);
  });

  it("leaves that dot drawn and its source in the diagram, to be corrected", async () => {
    const bad = "\\notacontrolsequence{v}";
    const diagram = withNamedDot({ x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0 }, bad);

    await setLabelsOf(diagram);
    renderDiagram(canvas, diagram);

    expect(drawnDots()).toHaveLength(1);
    expect(canvas.querySelector("g.dot-label")).toBeNull();
    expect(diagram.dots[0]?.source).toBe(bad);
  });

  it("costs that label alone, and neither another nor the rest of the drawing", async () => {
    const bad = "\\notacontrolsequence{s}";
    const first = placedAt(withBox({ x: 0, y: 0, w: 200, h: 200 }, "A"), { x: -40, y: 0 });
    const second = placedAt(first.diagram, { x: 40, y: 0 });
    const diagram = labelDot(labelDot(second.diagram, first.dot, bad), second.dot, "t");

    expect(await setLabelsOf(diagram)).toHaveLength(1);
    renderDiagram(canvas, diagram);

    expect(canvas.querySelectorAll("g.dot-label")).toHaveLength(1);
    expect(canvas.querySelectorAll("g.box-label")).toHaveLength(1);
    expect(drawnDots()).toHaveLength(2);
  });
});

// Once per source, not once per label per frame: a redraw rebuilds every label,
// and a source that would not set is remembered as such so that it is neither
// retried nor reported again.

describe("a source already set", () => {
  it("is not set a second time, whether it came to a run or to a refusal", async () => {
    const good = "\\alpha";
    const bad = "\\notacontrolsequence{r}";
    const diagram = withNamedDot({ x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0 }, bad, "left");
    const both: Diagram = {
      ...diagram,
      boxes: diagram.boxes.map((box) => ({ ...box, source: good })),
    };

    await setLabelsOf(both);
    await setLabelsOf(both);
    renderDiagram(canvas, both);

    expect([timesSet(good), timesSet(bad)]).toEqual([1, 1]);
  });
});

describe("vetting a source before a gesture puts it in the diagram", () => {
  it("takes one this backend can draw", async () => {
    await expect(vetSource("\\beta")).resolves.toBeUndefined();
  });

  it("refuses one it cannot, saying what the typesetter said", async () => {
    await expect(vetSource("\\notacontrolsequence{n}")).rejects.toThrow(
      /undefined control sequence/iu,
    );
  });

  it("asks the engine again when the same source is submitted twice", async () => {
    const bad = "\\notacontrolsequence{m}";

    await expect(vetSource(bad)).rejects.toThrow();
    await expect(vetSource(bad)).rejects.toThrow();

    // A submit is someone asking, where a redraw asks nothing — so a refusal a
    // bad moment produced is never frozen onto the source that met it.
    expect(timesSet(bad)).toBe(2);
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

describe("the rectangle a box is drawn in", () => {
  it("follows the drag, and is chrome rather than diagram", () => {
    draggingLands();

    pressAt(40, 40);
    moveTo(140, 90);

    const chrome = canvas.querySelector("g.chrome");
    expect(chrome?.getAttribute("pointer-events")).toBe("none");
    expect(cornerOf(chrome?.querySelector("rect"))).toEqual(["40", "-90", "100", "50"]);
    expect(drawnBoxes()).toHaveLength(0);
    // Let it go: a drag left in flight is still watching the window, and would
    // claim the next test's release.
    releaseAt(140, 90);
  });

  it("stands where the gesture left it, and goes when the gesture is done with it", async () => {
    draggingLands();

    pressAt(40, 40);
    releaseAt(140, 90);
    expect(cornerOf(canvas.querySelector("g.chrome > rect"))).toEqual(["40", "-90", "100", "50"]);

    // Nothing to show is what takes it down — when a gesture is done with its
    // mark is the gesture's own, and is asserted in gesture.test.ts.
    await vi.waitFor(() => expect(canvas.querySelector("g.chrome")).toBeNull());
  });

  it("is never drawn at all for a gesture with nothing to show", () => {
    // Nothing to show is nothing to draw, which is the backend's half of the
    // answer — that such a gesture is shown nothing is the gesture's own, and
    // is asserted in gesture.test.ts.
    enableDragging(
      canvas,
      () => "nothing",
      vi.fn(() => Promise.resolve()),
    );

    pressAt(40, 40);
    moveTo(140, 90);
    expect(canvas.querySelector("g.chrome")).toBeNull();

    releaseAt(140, 90);
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });
});
