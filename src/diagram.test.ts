// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// A schema is checked by what it will and will not accept, so half of this file
// is a typecheck: every `@ts-expect-error` below is an assertion that the model
// cannot hold something, and it is `pnpm typecheck` rather than `vitest` that
// makes it fail. The other half constructs a drawing, which is the only claim
// that types this strict have left a diagram writable at all.

import { describe, expect, it } from "vitest";

import type { Arrow, Box, Diagram, Dot, Equivalence, NewBox, Path } from "./diagram";
import { addBox, boxAt, EMPTY_DIAGRAM, takeId } from "./diagram";

// One counter, spent in creation order across all five sorts, exactly as a
// drawing would spend it — so the ids below are 1…9 without being written down.
const [BOX, afterBox] = takeId(EMPTY_DIAGRAM, "box");
const [X, afterX] = takeId(afterBox, "dot");
const [Y, afterY] = takeId(afterX, "dot");
const [P, afterP] = takeId(afterY, "path");
const [REFL, afterRefl] = takeId(afterP, "path");
const [F, afterF] = takeId(afterRefl, "arrow");
const [G, afterG] = takeId(afterF, "arrow");
const [PR1, afterPr1] = takeId(afterG, "arrow");
const [QINV, afterQinv] = takeId(afterPr1, "equivalence");

const TYPE_A = {
  id: BOX,
  source: "A",
  x: 0,
  y: 0,
  w: 40,
  h: 24,
  labelSlot: "top-left",
} satisfies Box;

/**
 * A named dot and an unnamed one: the label is optional, as a pair. Both sit
 * inside `TYPE_A`, their positions being relative to its centre.
 */
const DOT_X = { id: X, box: BOX, x: -12, y: -4, source: "x", labelSide: "left" } satisfies Dot;
const DOT_Y = { id: Y, box: BOX, x: 12, y: -4 } satisfies Dot;

const PATH_P = {
  id: P,
  a: X,
  b: Y,
  source: "p",
  labelT: 0.5,
  labelSide: "left",
  conclusion: true,
} satisfies Path;

/** `refl` at `x`: the one path carrying a shape of its own. */
const REFL_AT_X = {
  ...PATH_P,
  id: REFL,
  b: X,
  source: "\\mathsf{refl}",
  conclusion: false,
  loopDirection: Math.PI / 2,
  loopSize: 8,
} satisfies Path;

const ARROW_F = {
  id: F,
  inputs: [X],
  output: Y,
  source: "f",
  labelT: 0.5,
  labelSide: "left",
  role: "in-theory",
  conclusion: true,
} satisfies Arrow;

const ARROW_G = {
  ...ARROW_F,
  id: G,
  inputs: [Y],
  output: X,
  source: "g",
  conclusion: false,
} satisfies Arrow;

/**
 * A built-in rule, which concludes nothing and has nowhere to say so — written
 * out rather than spread off `ARROW_F`, since no built-in rule can be made by
 * taking the field off one that concludes.
 */
const RULE_PR1 = {
  id: PR1,
  inputs: [X],
  output: Y,
  source: "\\mathsf{pr}_1",
  labelT: 0.5,
  labelSide: "left",
  role: "built-in",
} satisfies Arrow;

const QINV_FG = { id: QINV, arrows: [F, G], conclusion: true } satisfies Equivalence;

const DRAWING: Diagram = {
  ...afterQinv,
  boxes: [TYPE_A],
  dots: [DOT_X, DOT_Y],
  paths: [PATH_P, REFL_AT_X],
  arrows: [ARROW_F, ARROW_G, RULE_PR1],
  equivalences: [QINV_FG],
};

describe("the diagram", () => {
  it("is constructible with nothing drawn in it", () => {
    expect(EMPTY_DIAGRAM).toEqual({
      nextId: 1,
      boxes: [],
      dots: [],
      paths: [],
      arrows: [],
      equivalences: [],
    });
  });

  it("spends one counter across the sorts, and leaves the diagram it was handed", () => {
    const [first, spent] = takeId(EMPTY_DIAGRAM, "box");
    const [second] = takeId(spent, "dot");

    expect([first, second]).toEqual([1, 2]);
    expect(EMPTY_DIAGRAM.nextId).toBe(1);
  });

  it("holds every kind the notation has, drawable or not", () => {
    expect(DRAWING.nextId).toBe(10);
    expect(DRAWING.dots.map((dot) => dot.box)).toEqual([BOX, BOX]);
    expect(DRAWING.equivalences[0]?.arrows).toEqual([F, G]);
    expect(DRAWING.paths[1]?.loopSize).toBe(8);
  });

  it("cannot express what would mean nothing", () => {
    // @ts-expect-error concluding a built-in rule is meta-theoretically nonsense
    const concludingRule: Arrow = { ...RULE_PR1, conclusion: true };

    // @ts-expect-error a box is never an anchor, and its id is not a dot's
    const pathOffABox: Path = { ...PATH_P, a: BOX };

    // @ts-expect-error an equivalence attaches to exactly two arrows
    const threeWay: Equivalence = { ...QINV_FG, arrows: [F, G, F] };

    // @ts-expect-error a side with no source places a label that does not exist
    const sideOnly: Dot = { ...DOT_Y, labelSide: "left" };

    // @ts-expect-error an arrow carrying nothing carries nothing
    const nullary: Arrow = { ...ARROW_F, inputs: [] };

    expect([concludingRule, pathOffABox, threeWay, sideOnly, nullary]).toHaveLength(5);
  });
});

// The geometry below is the diagram's own: no DOM, no pointer events, no faked
// layout. Everything a gesture needs to ask — what a point lands inside, what a
// new box pushes aside — is answered from the extents the model already holds.

/** A square box, the way a gesture that had measured its label would ask for one. */
function square(x: number, y: number, side = 20): NewBox {
  return { source: "A", x, y, w: side, h: side };
}

/** A box twice as wide as it is tall: one whose least axis is not its only one. */
function wide(x: number, y: number): NewBox {
  return { source: "A", x, y, w: 40, h: 20 };
}

function drawn(...boxes: NewBox[]): Diagram {
  return boxes.reduce((diagram, box) => addBox(diagram, box), EMPTY_DIAGRAM);
}

/** Where each box sits, in row order: the only thing making room ever changes. */
function centresOf(diagram: Diagram): number[][] {
  return diagram.boxes.map((box) => [box.x, box.y]);
}

function overlapping(one: Box, other: Box): boolean {
  return (
    Math.abs(one.x - other.x) < (one.w + other.w) / 2 &&
    Math.abs(one.y - other.y) < (one.h + other.h) / 2
  );
}

function someOverlap(diagram: Diagram): boolean {
  return diagram.boxes.some((one, index) =>
    diagram.boxes.slice(index + 1).some((other) => overlapping(one, other)),
  );
}

describe("making a box", () => {
  it("puts one in the diagram, off the counter every id comes from", () => {
    const next = addBox(EMPTY_DIAGRAM, square(10, -20));

    expect(next.boxes).toEqual([
      { id: 1, source: "A", x: 10, y: -20, w: 20, h: 20, labelSlot: "top-center" },
    ]);
    expect(next.nextId).toBe(2);
  });

  it("leaves the diagram it was handed unchanged", () => {
    const one = addBox(EMPTY_DIAGRAM, square(0, 0));
    const before = structuredClone(one);

    addBox(one, square(5, 0));

    expect(one).toEqual(before);
    expect(EMPTY_DIAGRAM.boxes).toEqual([]);
  });

  it("keeps the extent it was given when nothing is in the way", () => {
    expect(centresOf(drawn(square(0, 0), square(100, 100)))).toEqual([
      [0, 0],
      [100, 100],
    ]);
  });
});

describe("a box needing room another holds", () => {
  it("pushes it aside rather than being refused", () => {
    const next = drawn(square(0, 0), square(5, 0));

    // The pushed box clears by exactly the overlap — 15 of the 20 it shares.
    expect(centresOf(next)).toEqual([
      [-15, 0],
      [5, 0],
    ]);
    expect(someOverlap(next)).toBe(false);
  });

  it("moves it along whichever axis needs least, so a row slides rather than jumping", () => {
    // Clipped by 10 horizontally and by 18 vertically: a box in the same row.
    expect(centresOf(drawn(wide(0, 0), wide(30, 2)))).toEqual([
      [-10, 0],
      [30, 2],
    ]);
  });

  it("pushes a box that was clear of it but not of what it displaced", () => {
    expect(centresOf(drawn(square(0, 0), square(-22, 0), square(10, 0)))).toEqual([
      [-10, 0],
      [-30, 0],
      [10, 0],
    ]);
  });

  it("breaks a tie toward x, so one edit always moves the same boxes", () => {
    expect(centresOf(drawn(square(0, 0), square(10, 10)))).toEqual([
      [-10, 0],
      [10, 10],
    ]);
  });
});

describe("making room", () => {
  it("is never refused, even for a box dropped exactly on top of one", () => {
    const next = drawn(square(0, 0), square(0, 0));

    expect(next.boxes).toHaveLength(2);
    expect(someOverlap(next)).toBe(false);
  });

  it("settles a whole grid with nothing overlapping", () => {
    const offsets = [-30, 0, 30];
    const grid = drawn(...offsets.flatMap((x) => offsets.map((y) => square(x, y))));

    const next = addBox(grid, square(0, 0, 100));

    expect(next.boxes).toHaveLength(10);
    expect(someOverlap(next)).toBe(false);
  });

  it("never moves the new box off the rectangle it was drawn on", () => {
    // Three boxes whose cascade, when the new one is allowed to give way like
    // any other, walks it ten units off the drag that made it.
    const next = drawn(
      { source: "A", x: -5, y: 15, w: 40, h: 30 },
      { source: "A", x: -10, y: 20, w: 10, h: 40 },
      { source: "A", x: 20, y: 10, w: 20, h: 30 },
    );

    expect(next.boxes.at(-1)).toMatchObject({ x: 20, y: 10, w: 20, h: 30 });
    expect(someOverlap(next)).toBe(false);
  });
});

describe("a drawing made gesture by gesture", () => {
  it("lands every box where it was drawn, and leaves nothing overlapping", () => {
    // A drawing is a sequence of gestures, so the check is too: each box in
    // turn has to land where it was drawn and leave nothing overlapping.
    let seed = 20260802;
    const upTo = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * bound);
    };

    for (let drawing = 0; drawing < 500; drawing += 1) {
      let diagram = EMPTY_DIAGRAM;
      for (let gesture = 0; gesture < 2 + upTo(8); gesture += 1) {
        // The extents a floored gesture can produce, over a canvas-sized plane.
        const asked = {
          source: "A",
          x: upTo(700) - 350,
          y: upTo(500) - 250,
          w: 34 + upTo(200),
          h: 33 + upTo(120),
        };
        diagram = addBox(diagram, asked);

        expect(diagram.boxes.at(-1)).toMatchObject(asked);
        expect(someOverlap(diagram)).toBe(false);
      }
    }
  });
});

describe("what a point lands inside", () => {
  const pair = drawn(square(0, 0), square(100, 100));

  it("is the box holding it", () => {
    expect(boxAt(pair, { x: 5, y: -5 })?.x).toBe(0);
    expect(boxAt(pair, { x: 95, y: 105 })?.x).toBe(100);
  });

  it("is nothing at all on empty canvas", () => {
    expect(boxAt(pair, { x: 50, y: 50 })).toBeUndefined();
    expect(boxAt(EMPTY_DIAGRAM, { x: 0, y: 0 })).toBeUndefined();
  });

  it("is measured against the extent the box carries, wall included", () => {
    expect(boxAt(pair, { x: 10, y: 10 })?.id).toBe(1);
    expect(boxAt(pair, { x: 10.5, y: 0 })).toBeUndefined();
  });
});
