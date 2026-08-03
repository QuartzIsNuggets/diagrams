// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// Making a box, end to end: a press on empty canvas, a type expression, and a
// box on screen because the diagram holds one. The rules the shell goes by are
// tested where they live — the geometry in diagram.test.ts with no DOM, the
// gesture in render-svg.test.ts — and what is left here is the wiring between
// them, which is only true of a real document.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas } from "./canvas";
import { EMPTY_DIAGRAM } from "./diagram";
import type { Editor } from "./editor";
import { createEditor } from "./editor";
import { createNamingBar } from "./naming-bar";

let canvas: SVGSVGElement;
let bar: HTMLFormElement;
let editor: Editor;

function boxesOn(): SVGRectElement[] {
  return [...canvas.querySelectorAll<SVGRectElement>("g.diagram g.box > rect")];
}

function dotsOn(): SVGCircleElement[] {
  return [...canvas.querySelectorAll<SVGCircleElement>("g.diagram circle.term-dot")];
}

function dotLabelsOn(): SVGGElement[] {
  return [...canvas.querySelectorAll<SVGGElement>("g.diagram g.dot-label")];
}

function centresOf(): (string | null)[][] {
  return dotsOn().map((dot) => [dot.getAttribute("cx"), dot.getAttribute("cy")]);
}

function extentOf(rect: SVGRectElement | undefined): number[] {
  return ["x", "y", "width", "height"].map((name) => Number(rect?.getAttribute(name)));
}

/** Whether two drawn rectangles share any area at all. */
function overlapping(one: number[], other: number[]): boolean {
  const [x = 0, y = 0, w = 0, h = 0] = one;
  const [otherX = 0, otherY = 0, otherW = 0, otherH = 0] = other;
  return x < otherX + otherW && otherX < x + w && y < otherY + otherH && otherY < y + h;
}

function pointer(kind: string, clientX: number, clientY: number): void {
  canvas.dispatchEvent(new PointerEvent(kind, { clientX, clientY, button: 0, bubbles: true }));
}

/** Press, drag and release: the whole of what makes a box, bar naming it. */
function dragOut(fromX: number, fromY: number, toX: number, toY: number): void {
  pointer("pointerdown", fromX, fromY);
  pointer("pointermove", toX, toY);
  pointer("pointerup", toX, toY);
}

/** Type `latex` into the bar and press its button, the way a user would. */
function submit(latex: string): void {
  const input = bar.querySelector("input");
  const button = bar.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!input || !button) {
    throw new Error("the bar has lost its input");
  }
  input.value = latex;
  button.click();
}

function press(key: string): void {
  bar.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/**
 * Give the bar an extent.
 *
 * jsdom has no layout, so every `getBoundingClientRect()` is zeros — and the
 * bar's own extent is half of where it goes, the shell placing it by its corner
 * rather than translating it onto the point.
 */
function sizeBar(width: number, height: number): void {
  bar.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, width, height);
}

/** Drag a box out and name it, waiting for it to land. */
async function makeBox(
  from: [number, number],
  to: [number, number],
  source = "A",
): Promise<SVGRectElement[]> {
  const before = boxesOn().length;
  dragOut(from[0], from[1], to[0], to[1]);
  submit(source);
  await vi.waitFor(() => expect(boxesOn()).toHaveLength(before + 1));
  return boxesOn();
}

/** Give up on whatever the bar is asking, and wait for it back in its corner. */
async function giveUp(): Promise<void> {
  press("Escape");
  await vi.waitFor(() => expect(bar.classList.contains("asking")).toBe(false));
}

/**
 * Plop a dot and name it, waiting for the label to land.
 *
 * Every dot the editor places is asked for a name, and one question is open at
 * a time — so a test placing a second dot has to have answered for the first.
 */
async function plopDot(x: number, y: number, source = "x"): Promise<void> {
  const before = dotLabelsOn().length;
  dragOut(x, y, x, y);
  submit(source);
  await vi.waitFor(() => expect(dotLabelsOn()).toHaveLength(before + 1));
}

function refusalText(): string {
  return document.querySelector(".canvas-error")?.textContent ?? "";
}

beforeEach(() => {
  canvas = createCanvas();
  bar = createNamingBar();
  editor = createEditor(canvas, bar);
  document.body.replaceChildren(editor.region, bar);
});

describe("the editor", () => {
  it("draws the diagram it starts with, which holds nothing", () => {
    expect(canvas.querySelector("g.diagram")).not.toBeNull();
    expect(boxesOn()).toHaveLength(0);
  });

  it("hands out the diagram it is holding, which is what is on screen", async () => {
    expect(editor.diagramNow()).toEqual(EMPTY_DIAGRAM);

    await makeBox([40, 40], [240, 200]);

    // Read again, not held from before: a gesture makes the *next* diagram, so
    // a caller keeping the first would be holding an empty one for good.
    expect(editor.diagramNow().boxes).toHaveLength(1);
    expect(editor.diagramNow().boxes[0]?.source).toBe("A");
  });

  it("has a region for a refusal before it has anything to refuse", () => {
    const region = document.querySelector(".canvas-error");
    expect(region?.getAttribute("role")).toBe("alert");
    expect(region?.textContent).toBe("");
  });
});

describe("a drag on empty canvas", () => {
  it("asks for a type expression, at the slot the label will take", () => {
    sizeBar(200, 30);

    dragOut(40, 40, 140, 90);

    expect(bar.classList.contains("asking")).toBe(true);
    // The middle of the bar's bottom edge sits on the middle of the rectangle's
    // top edge — (90, 40) in page coordinates — so its corner is half a width
    // left of that and a whole height above it.
    expect([bar.style.left, bar.style.top]).toEqual(["-10px", "10px"]);
  });

  it("puts no box on the canvas until a source comes back", () => {
    dragOut(40, 40, 140, 90);

    expect(boxesOn()).toHaveLength(0);
    expect(canvas.querySelector("g.chrome > rect")).not.toBeNull();
  });

  it("makes a box the size of the drag once one does", async () => {
    const [box] = await makeBox([40, 40], [240, 140]);

    expect(extentOf(box)).toEqual([40, -140, 200, 100]);
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });

  it("draws the box's label from the source it was named with", async () => {
    await makeBox([40, 40], [240, 140]);

    expect(canvas.querySelectorAll("g.box-label path").length).toBeGreaterThan(0);
  });

  it("empties the bar, so the next box starts from nothing typed", async () => {
    await makeBox([40, 40], [240, 140]);

    expect(bar.querySelector("input")?.value).toBe("");
    expect(bar.classList.contains("asking")).toBe(false);
  });
});

describe("a box too small for its label", () => {
  it("is grown to fit it", async () => {
    const [box] = await makeBox([100, 100], [104, 104]);

    const [, , width, height] = extentOf(box);
    expect(width).toBeGreaterThan(4);
    expect(height).toBeGreaterThan(4);
  });

  it("needs no threshold telling a click from a drag — a click is a drag of no size", async () => {
    const [tiny] = await makeBox([100, 100], [104, 104]);
    const [clicked] = await makeBox([400, 400], [400, 400]);

    const [, , tinyWidth, tinyHeight] = extentOf(tiny);
    const [, , clickedWidth, clickedHeight] = extentOf(clicked);
    expect([clickedWidth, clickedHeight]).toEqual([tinyWidth, tinyHeight]);
  });
});

describe("a box needing room another holds", () => {
  it("is never refused: the drag lands and the other slides clear", async () => {
    await makeBox([100, 100], [100, 100]);

    // Pressed on empty canvas and released across the box already there.
    const boxes = await makeBox([200, 100], [110, 100]);

    expect(boxes).toHaveLength(2);
    expect(overlapping(extentOf(boxes[0]), extentOf(boxes[1]))).toBe(false);
  });
});

describe("a source that will not typeset", () => {
  const BAD = "\\notacontrolsequence{x}";

  it("makes no box, and the rectangle goes with it", async () => {
    dragOut(40, 40, 240, 140);
    submit(BAD);

    await vi.waitFor(() => expect(refusalText()).toMatch(/undefined control sequence/iu));
    expect(boxesOn()).toHaveLength(0);
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });

  it("keeps the source in the input to be corrected", async () => {
    dragOut(40, 40, 240, 140);
    submit(BAD);

    await vi.waitFor(() => expect(refusalText()).toBeTruthy());
    expect(bar.querySelector("input")?.value).toBe(BAD);
  });

  it("is forgotten as soon as a box lands", async () => {
    dragOut(40, 40, 240, 140);
    submit(BAD);
    await vi.waitFor(() => expect(refusalText()).toBeTruthy());

    await makeBox([300, 300], [400, 400]);

    expect(refusalText()).toBe("");
  });

  it("does not stop the box that follows it", async () => {
    dragOut(40, 40, 240, 140);
    submit(BAD);
    await vi.waitFor(() => expect(refusalText()).toBeTruthy());

    const [box] = await makeBox([300, 300], [400, 400]);

    expect(extentOf(box)).toEqual([300, -400, 100, 100]);
  });
});

describe("giving up on a box", () => {
  it("leaves none, Escape having nothing to name", async () => {
    dragOut(40, 40, 240, 140);

    press("Escape");

    await vi.waitFor(() => expect(canvas.querySelector("g.chrome")).toBeNull());
    expect(boxesOn()).toHaveLength(0);
    expect(refusalText()).toBe("");
  });

  it("leaves none for a submit with nothing in it either", async () => {
    dragOut(40, 40, 240, 140);

    submit("   ");

    await vi.waitFor(() => expect(canvas.querySelector("g.chrome")).toBeNull());
    expect(boxesOn()).toHaveLength(0);
  });

  it("leaves the bar back in its corner, ready for the next one", async () => {
    dragOut(40, 40, 240, 140);
    press("Escape");
    await vi.waitFor(() => expect(canvas.querySelector("g.chrome")).toBeNull());
    expect(bar.classList.contains("asking")).toBe(false);
    expect(bar.style.left).toBe("");

    const [box] = await makeBox([300, 300], [400, 400]);

    expect(extentOf(box)).toEqual([300, -400, 100, 100]);
  });
});

describe("a press inside a box", () => {
  it("starts no box — the diagram says what the press landed in", async () => {
    await makeBox([40, 40], [240, 140]);

    pointer("pointerdown", 100, 100);
    pointer("pointermove", 150, 120);

    expect(canvas.querySelector("g.chrome")).toBeNull();
    pointer("pointerup", 150, 120);
    expect(boxesOn()).toHaveLength(1);
  });

  it("places a term-dot, at the release point rather than the press point", async () => {
    await makeBox([40, 40], [240, 140]);

    dragOut(100, 100, 150, 120);

    expect(centresOf()).toEqual([["150", "-120"]]);
    await giveUp();
  });

  it("puts it in the diagram, so it is redrawn along with everything else", async () => {
    await makeBox([40, 40], [240, 140]);
    await plopDot(100, 100);

    await makeBox([400, 400], [500, 500], "B");

    expect(centresOf()).toEqual([["100", "-100"]]);
    expect(dotLabelsOn()).toHaveLength(1);
    expect(boxesOn()).toHaveLength(2);
  });
});

describe("naming a term-dot", () => {
  it("asks for a source at the dot, once it is down", async () => {
    await makeBox([40, 40], [240, 140]);

    dragOut(100, 100, 150, 120);

    expect(dotsOn()).toHaveLength(1);
    expect(bar.classList.contains("asking")).toBe(true);
    await giveUp();
  });

  it("draws the label from the source it was named with", async () => {
    await makeBox([40, 40], [240, 140]);

    await plopDot(100, 100, "z'");

    expect(dotLabelsOn()[0]?.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("leaves the dot unnamed where the question is given up on, the name being optional", async () => {
    await makeBox([40, 40], [240, 140]);

    dragOut(100, 100, 100, 100);

    await giveUp();
    expect(dotsOn()).toHaveLength(1);
    expect(dotLabelsOn()).toHaveLength(0);
  });
});

describe("a dot's source that will not typeset", () => {
  it("is kept out of the diagram and left in the input", async () => {
    const bad = "\\notacontrolsequence{x}";
    await makeBox([40, 40], [240, 140]);

    dragOut(100, 100, 100, 100);
    submit(bad);

    await vi.waitFor(() => expect(refusalText()).toMatch(/undefined control sequence/iu));
    expect(dotsOn()).toHaveLength(1);
    expect(dotLabelsOn()).toHaveLength(0);
    expect(bar.querySelector("input")?.value).toBe(bad);
  });

  it("does not stop the dot that follows it", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);
    submit("\\notacontrolsequence{x}");
    await vi.waitFor(() => expect(refusalText()).toBeTruthy());

    await plopDot(200, 120, "y");

    expect(dotLabelsOn()).toHaveLength(1);
    expect(refusalText()).toBe("");
  });

  it("starts no second gesture while the question is open", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);

    dragOut(400, 400, 500, 500);

    expect(boxesOn()).toHaveLength(1);
    expect(canvas.querySelector("g.chrome")).toBeNull();
    await giveUp();
  });
});

describe("a release with nowhere to put a dot", () => {
  it("places none outside every box, and says so in the canvas's own region", async () => {
    await makeBox([40, 40], [240, 140]);

    dragOut(100, 100, 500, 500);

    expect(dotsOn()).toHaveLength(0);
    expect(refusalText()).toMatch(/inside a box/iu);
  });

  it("places none on a dot already down, whether released onto it or dragged onto it", async () => {
    await makeBox([40, 40], [240, 140]);
    await plopDot(100, 100);

    dragOut(100, 100, 100, 100);
    expect(dotsOn()).toHaveLength(1);

    dragOut(200, 120, 103, 102);
    expect(dotsOn()).toHaveLength(1);
    expect(refusalText()).toMatch(/too close/iu);
  });

  it("is forgotten as soon as a dot lands", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 500, 500);
    expect(refusalText()).toBeTruthy();

    await plopDot(150, 120);

    expect(dotsOn()).toHaveLength(1);
    expect(refusalText()).toBe("");
  });
});

describe("what the canvas holds besides the diagram", () => {
  it("gains no term-dot from a gesture that made a box", async () => {
    await makeBox([40, 40], [240, 140]);

    expect(dotsOn()).toHaveLength(0);
  });
});
