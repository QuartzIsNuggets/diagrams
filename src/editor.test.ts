// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// Making a box, end to end: a press on empty canvas, a type expression, and a
// box on screen because the diagram holds one. The rules the shell goes by are
// tested where they live — the geometry in diagram.test.ts with no DOM, the
// gesture in gesture.test.ts with no canvas — and what is left here is the
// wiring between them, which is only true of a real document.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas } from "./canvas";
import { EMPTY_DIAGRAM } from "./diagram";
import type { Editor } from "./editor";
import { createEditor } from "./editor";

/** The width every bar summoned in these tests reports having. */
const BAR_WIDTH = 200;

/** How far the bar's body stands off the mark its tail points at. */
const STANDOFF = 14;

let canvas: SVGSVGElement;
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

/** The bar, if a gesture is being asked about: it is on the page only then. */
function barOn(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>(".naming-bar");
}

/** The bar there had better be, for a test that answers what it is asking. */
function bar(): HTMLFormElement {
  const found = barOn();
  if (!found) {
    throw new Error("no bar is asking");
  }
  return found;
}

/**
 * Type `latex` into the bar and commit it, the way a user would.
 *
 * `requestSubmit` because the bar has nothing to press: what a user presses is
 * Enter, which submits a form whose only field is a text input — implicitly,
 * which jsdom does not do at all.
 */
function submit(latex: string): void {
  const input = bar().querySelector("input");
  if (!input) {
    throw new Error("the bar has lost its input");
  }
  input.value = latex;
  bar().requestSubmit();
}

function press(key: string): void {
  bar().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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

/** Let a naming that has been answered come back: a turn of the event loop. */
async function settled(): Promise<void> {
  await new Promise((resume) => {
    setTimeout(resume, 0);
  });
}

/** Give up on whatever the bar is asking, and wait for the gesture to be over. */
async function giveUp(): Promise<void> {
  press("Escape");
  await vi.waitFor(() => expect(barOn()).toBeNull());
  // The bar goes as Escape is read; the gesture it was asking for ends a turn
  // later, when the naming it was waiting on comes back. A test that goes on to
  // make the next mark has to be past that — one question is open at a time.
  await settled();
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

/** What the bar says of the source it is holding: the other of the two regions. */
function barReason(): string {
  return barOn()?.querySelector(".naming-error")?.textContent ?? "";
}

/** A source no backend will set, whatever mark is being named with it. */
const BAD = "\\notacontrolsequence{x}";

/** Name whatever is being asked about with {@link BAD}, and wait for the bar to say so. */
async function refuseSource(): Promise<void> {
  submit(BAD);
  await vi.waitFor(() => expect(barReason()).toMatch(/undefined control sequence/iu));
}

beforeEach(() => {
  // There is one bar for the page rather than one per editor, so a question the
  // last test walked away from is still the open one and would refuse the first
  // press of this test. Given up on the way a user would.
  barOn()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  canvas = createCanvas();
  editor = createEditor(canvas);
  document.body.replaceChildren(editor.region);
  // jsdom has no layout, so every `getBoundingClientRect()` is zeros — and half
  // the bar's width is where it goes, the bar centring itself on the mark. On
  // the prototype because there is no bar until a gesture summons one.
  vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, BAR_WIDTH, 30),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
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
  it("summons a bar for a type expression, at the slot the label will take", () => {
    // Drawn well inside the window, so what is read here is the slot and not
    // the room the bar found: finding room is naming-bar.test.ts's own.
    dragOut(140, 140, 340, 240);

    // The bar's tail points at the middle of the rectangle's top edge — (240,
    // 140) in page coordinates — so the bar hangs half a width left of that,
    // and a standoff clear of it, the dashed wall staying visible under the tail.
    expect([bar().style.left, bar().style.bottom]).toEqual([
      `${String(240 - BAR_WIDTH / 2)}px`,
      `${String(window.innerHeight - 140 + STANDOFF)}px`,
    ]);
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

  it("takes the bar off the page once the box lands, the question being answered", async () => {
    await makeBox([40, 40], [240, 140]);

    expect(barOn()).toBeNull();
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

describe("a box's source that will not typeset", () => {
  it("makes no box, and keeps the bar open at the rectangle it is about", async () => {
    dragOut(40, 40, 240, 140);

    await refuseSource();

    expect(boxesOn()).toHaveLength(0);
    expect(barOn()).not.toBeNull();
    expect(canvas.querySelector("g.chrome > rect")).not.toBeNull();
  });

  it("keeps the source in the input to be corrected", async () => {
    dragOut(40, 40, 240, 140);

    await refuseSource();

    expect(bar().querySelector("input")?.value).toBe(BAD);
  });

  it("is answered at the mark and not in the canvas's own region", async () => {
    dragOut(40, 40, 240, 140);

    await refuseSource();

    expect(refusalText()).toBe("");
    expect(barReason()).not.toContain(BAD);
  });
});

describe("correcting a box's source", () => {
  it("makes the box, the drag having waited for a source that sets", async () => {
    dragOut(40, 40, 240, 140);
    await refuseSource();

    submit("A");

    await vi.waitFor(() => expect(boxesOn()).toHaveLength(1));
    expect(extentOf(boxesOn()[0])).toEqual([40, -140, 200, 100]);
    expect(barReason()).toBe("");
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });

  it("is given up on with Escape, leaving no box and nothing typed", async () => {
    dragOut(40, 40, 240, 140);
    await refuseSource();

    await giveUp();

    expect(boxesOn()).toHaveLength(0);
    expect(barOn()).toBeNull();
    expect(canvas.querySelector("g.chrome")).toBeNull();
  });

  it("stops nothing once it is over: the next box lands as any other", async () => {
    dragOut(40, 40, 240, 140);
    await refuseSource();
    await giveUp();

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

  it("leaves no bar on the page, ready for the next one", async () => {
    dragOut(40, 40, 240, 140);
    press("Escape");
    await vi.waitFor(() => expect(canvas.querySelector("g.chrome")).toBeNull());
    expect(barOn()).toBeNull();

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
    // Aimed at the dot itself — (150, 120) in page coordinates — rather than at
    // where the glyphs will land, which is the backend's own business, and
    // standing a standoff clear so the dot is still there to be seen.
    expect([bar().style.left, bar().style.bottom]).toEqual([
      `${String(150 - BAR_WIDTH / 2)}px`,
      `${String(window.innerHeight - 120 + STANDOFF)}px`,
    ]);
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
  it("is kept out of the diagram and left in the input, the bar still asking", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);

    await refuseSource();

    expect(dotsOn()).toHaveLength(1);
    expect(dotLabelsOn()).toHaveLength(0);
    expect(bar().querySelector("input")?.value).toBe(BAD);
    expect(refusalText()).toBe("");
  });

  it("is given up on by a press elsewhere as readily as a fresh question", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);
    await refuseSource();

    dragOut(400, 400, 500, 500);

    // What the press reads is the mark, not what the question was doing: a dot
    // can stand unnamed whether or not a source of its own was refused first.
    expect(dotsOn()).toHaveLength(1);
    expect(dotLabelsOn()).toHaveLength(0);
    expect(bar().querySelector("input")?.value).toBe("");
    await giveUp();
  });
});

describe("correcting a dot's source", () => {
  it("names the dot the correction sets", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);
    await refuseSource();

    submit("x");

    await vi.waitFor(() => expect(dotLabelsOn()).toHaveLength(1));
    expect(barReason()).toBe("");
  });

  it("leaves the dot unnamed where it is given up on instead", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);
    await refuseSource();

    await giveUp();

    expect(dotsOn()).toHaveLength(1);
    expect(dotLabelsOn()).toHaveLength(0);
  });

  it("stops nothing once it is over: the next dot lands as any other", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);
    await refuseSource();
    await giveUp();

    await plopDot(200, 120, "y");

    expect(dotLabelsOn()).toHaveLength(1);
    expect(refusalText()).toBe("");
  });
});

describe("a press elsewhere while a term-dot is being named", () => {
  it("gives up on the name and begins the next gesture in the same press", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);

    // One press, doing both: the dot is given up on and the drag it began is
    // under way, where Escape and a press would have been two.
    dragOut(400, 400, 500, 500);
    submit("B");

    await vi.waitFor(() => expect(boxesOn()).toHaveLength(2));
  });

  it("leaves that gesture the canvas: the naming it displaced ends nothing", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 100, 100);

    dragOut(400, 400, 500, 500);
    await settled();

    // The naming given up on has come back by now, and the rectangle standing is
    // the one the press that displaced it swept — the mark the bar is asking
    // about. Ending its gesture would have taken that down.
    expect(canvas.querySelector("g.chrome > rect")).not.toBeNull();
    expect(barOn()).not.toBeNull();
    await giveUp();
  });

  it("leaves the dot given up on where it was, unnamed", async () => {
    await makeBox([40, 40], [240, 140]);
    dragOut(100, 100, 150, 120);

    dragOut(400, 400, 500, 500);

    expect(centresOf()).toEqual([["150", "-120"]]);
    expect(dotLabelsOn()).toHaveLength(0);
    await giveUp();
  });
});

describe("a press elsewhere while a box is being named", () => {
  it("is refused: the bar moves, keeps its source, and keeps asking", async () => {
    dragOut(40, 40, 240, 140);
    await refuseSource();

    dragOut(400, 400, 500, 500);

    // The balk says a refusal happened and the line says which, and nothing
    // else changed: the one bar is still asking, holding the source it was
    // given. The line stands for the press now, that being the last refusal.
    expect(bar().classList.contains("balking")).toBe(true);
    expect(document.querySelectorAll(".naming-bar")).toHaveLength(1);
    expect(bar().querySelector("input")?.value).toBe(BAD);
    expect(barReason()).toMatch(/esc/iu);
    await giveUp();
  });

  it("begins no gesture: the rectangle being asked about is the only one", async () => {
    dragOut(40, 40, 240, 140);
    const rectangle = extentOf(
      canvas.querySelector<SVGRectElement>("g.chrome > rect") ?? undefined,
    );

    dragOut(400, 400, 500, 500);

    // A gesture had it begun would have dragged the provisional rectangle out
    // to the new drag, and its release would have asked about a second box.
    expect(extentOf(canvas.querySelector<SVGRectElement>("g.chrome > rect") ?? undefined)).toEqual(
      rectangle,
    );
    expect(boxesOn()).toHaveLength(0);
    await giveUp();
  });

  it("leaves Escape the way out, and gives up on the box for good", async () => {
    dragOut(40, 40, 240, 140);
    dragOut(400, 400, 500, 500);

    await giveUp();

    expect(boxesOn()).toHaveLength(0);
    expect(canvas.querySelector("g.chrome")).toBeNull();
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
