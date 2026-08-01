// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// A schema is checked by what it will and will not accept, so half of this file
// is a typecheck: every `@ts-expect-error` below is an assertion that the model
// cannot hold something, and it is `pnpm typecheck` rather than `vitest` that
// makes it fail. The other half constructs a drawing, which is the only claim
// that types this strict have left a diagram writable at all.

import { describe, expect, it } from "vitest";

import type { Arrow, Box, Diagram, Dot, Equivalence, Path } from "./diagram";
import { EMPTY_DIAGRAM, takeId } from "./diagram";

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
