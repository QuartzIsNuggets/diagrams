// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The editor shell: it holds the current diagram and drives the two things that
// act on one — the transitions that take it to the next diagram, and the backend
// that draws it. Nothing here is the document. What is on screen is on screen
// because the diagram holds it, and a gesture that changes the drawing does so
// by making the next diagram, never by appending to the canvas.

import type { Diagram, DotId, Extent, Point, Refusal } from "./diagram";
import { addBox, addDot, boxAt, EMPTY_DIAGRAM, labelDot } from "./diagram";
import { messageOf } from "./failure";
import { askForSource, clearSource } from "./label-form";
import type { Unset } from "./render-svg";
import {
  clearChrome,
  enableDragging,
  measureBox,
  renderDiagram,
  setLabelsOf,
  toPagePoint,
  vetSource,
} from "./render-svg";

/**
 * The editor — the canvas, and the region a refused gesture is reported in —
 * wired and ready to append.
 *
 * `form` is the one place LaTeX is typed: the shell sends it to whatever is
 * being named — the rectangle a box is drawn in, the dot just plopped — and
 * takes the source back from it, which is all either knows of the other. It
 * comes back already listening, there being no useful moment between a canvas
 * and a canvas that draws.
 */
export function createEditor(canvas: SVGSVGElement, form: HTMLFormElement): HTMLDivElement {
  const editor = document.createElement("div");
  editor.classList.add("editor");

  // In the tree before it has anything to say, so a refusal is announced rather
  // than appearing from nowhere. One region, not one per gesture: "why did
  // nothing appear?" is one question.
  const refusal = document.createElement("p");
  refusal.classList.add("canvas-error");
  refusal.setAttribute("role", "alert");

  editor.append(canvas, refusal);
  enableDrawing(canvas, form, refusal);
  return editor;
}

/**
 * What a refused gesture says, one wording per reason the model gives.
 *
 * The model hands back a reason and no sentence: how a refusal is put is of a
 * piece with the region it is put into, and both are the shell's.
 */
const REFUSALS: Record<Refusal, string> = {
  "outside-every-box":
    "A term-dot goes inside a box — a term outside a type is nothing a diagram can hold.",
  "too-close-to-a-dot":
    "Term-dots stand apart — that release is too close to a dot already placed.",
};

/**
 * What a diagram nothing here constructed is told about the sources this
 * backend could not set.
 *
 * Named rather than counted: each one is still in the diagram to be corrected,
 * and it is the LaTeX that says which to correct.
 */
function unsetWording(unset: readonly Unset[]): string {
  return unset.map(({ source, why }) => `“${source}” could not be typeset: ${why}`).join(" ");
}

/**
 * What a gesture acts on: the diagram on screen, what draws it, what asks for a
 * source, and where a refusal is put.
 *
 * The one mutable thing the editor has. `current` is the document — every mark
 * on the canvas is there because it holds one — and `naming` says whether the
 * single input is already answering someone, since a second question would
 * throw away the first's typed source.
 */
interface Shell {
  readonly canvas: SVGSVGElement;
  readonly form: HTMLFormElement;
  readonly refusal: HTMLParagraphElement;
  current: Diagram;
  naming: boolean;
}

/**
 * Draw the diagram as it stands, and set whatever label in it has not been set.
 *
 * Drawing is synchronous and typesetting is not, so what is already set is on
 * screen at once and the rest arrives when it is. For a drawing the gestures
 * below made there is never anything left to set — each vets its source before
 * the diagram holds it — so the second pass is what a diagram this editor did
 * not construct will land by, and what could not be set is reported rather than
 * dropped.
 */
function draw(shell: Shell): void {
  renderDiagram(shell.canvas, shell.current);
  void settle(shell);
}

async function settle(shell: Shell): Promise<void> {
  const unset = await setLabelsOf(shell.current);
  // Redrawn from `current` rather than from the diagram this started on, so a
  // gesture that landed meanwhile is not undone by a label arriving late.
  renderDiagram(shell.canvas, shell.current);
  // Written only when there is something to say, never cleared: settling is not
  // an attempt, and a gesture in flight may already have put its own failure
  // here. What clears this report is the next thing that lands.
  if (unset.length > 0) {
    shell.refusal.textContent = unsetWording(unset);
  }
}

/**
 * Run a naming out, and draw whatever it settles on.
 *
 * The one place a gesture ends, whichever mark it was making. A source that
 * will not typeset rejects, and that is the only thing either naming reports:
 * a message stands for the last attempt, so anything that is not a refusal — a
 * mark named, a question given up on — empties the region instead.
 */
async function named(shell: Shell, naming: Promise<Diagram>): Promise<void> {
  try {
    shell.current = await naming;
    draw(shell);
    shell.refusal.textContent = "";
  } catch (failure: unknown) {
    shell.refusal.textContent = messageOf(failure);
  } finally {
    // However it went, the gesture is over: any rectangle it drew goes, and the
    // next press is free to start another.
    clearChrome(shell.canvas);
    shell.naming = false;
  }
}

/**
 * Put the dot where the release landed, then ask what it is called.
 *
 * The dot goes down before the question is asked and stays whatever the answer:
 * a term-dot's label is optional, so a question given up on leaves an unnamed
 * dot rather than nothing — where a box, which *is* its type expression, is
 * never made at all. Asking first would cost more than it bought, a release the
 * model refuses then throwing away a source already typed.
 */
async function nameDot(shell: Shell, at: Point): Promise<void> {
  const placed = addDot(shell.current, at);
  if (typeof placed === "string") {
    shell.refusal.textContent = REFUSALS[placed];
    shell.naming = false;
    return;
  }
  shell.current = placed.diagram;
  shell.refusal.textContent = "";
  draw(shell);

  await named(shell, dotNamed(shell, placed.dot, at));
}

/**
 * Make a gesture on the canvas draw, and hold the diagram it draws into.
 *
 * The press decides which mark is being made — empty canvas is a box, inside a
 * box is a term-dot — and the release decides only where it lands. Only the
 * diagram can say which of the two a press landed on, and it says so from the
 * extents it holds rather than from anything drawn. What the press settled on is
 * kept in `making` until the release places it.
 *
 * A press while a question is open starts nothing: one input holds one question,
 * and a press that quietly cancelled it would throw away a typed source.
 */
function enableDrawing(
  canvas: SVGSVGElement,
  form: HTMLFormElement,
  refusal: HTMLParagraphElement,
): void {
  const shell: Shell = { canvas, form, refusal, current: EMPTY_DIAGRAM, naming: false };
  let making: "box" | "dot" = "box";
  draw(shell);

  enableDragging(
    canvas,
    (at) => {
      if (shell.naming) {
        return "no-gesture";
      }
      making = boxAt(shell.current, at) ? "dot" : "box";
      // A dot has no extent to show: a rectangle following the pointer would
      // say a box was coming.
      return making === "box" ? "rectangle" : "nothing";
    },
    (drag, at) => {
      shell.naming = true;
      void (making === "box" ? named(shell, boxFrom(shell, drag)) : nameDot(shell, at));
    },
  );
}

/**
 * Ask for the box's type expression, and hand back the diagram that has the
 * box — or the one handed in, where the question was given up on.
 *
 * The rectangle stays up while the question is open: it is what the question is
 * about, which is why the input goes to it rather than a modal covering it. A
 * source that will not typeset rejects, so nothing is added and the source stays
 * in the input to be corrected.
 */
async function boxFrom(shell: Shell, drag: Extent): Promise<Diagram> {
  // At the label slot a new box takes, so a source is typed where the label it
  // becomes will be.
  const slot = toPagePoint(shell.canvas, { x: drag.x, y: drag.y + drag.h / 2 });
  const source = await askForSource(shell.form, slot);
  if (!source) {
    return shell.current;
  }

  const floor = await measureBox(source);
  clearSource(shell.form);
  return addBox(shell.current, {
    source,
    x: drag.x,
    y: drag.y,
    w: Math.max(drag.w, floor.w),
    h: Math.max(drag.h, floor.h),
  });
}

/**
 * Ask what the dot just placed is called, and hand back the diagram that has it
 * named — or the one handed in, where the question was given up on.
 *
 * The bar goes to the dot itself rather than to where the glyphs will land: the
 * dot is the mark the question is about, and how far off it a label stands is
 * the backend's own. A source that will not typeset rejects, so the dot keeps
 * no name and the source stays in the input to be corrected.
 */
async function dotNamed(shell: Shell, dot: DotId, at: Point): Promise<Diagram> {
  const source = await askForSource(shell.form, toPagePoint(shell.canvas, at));
  if (!source) {
    return shell.current;
  }

  await vetSource(source);
  clearSource(shell.form);
  return labelDot(shell.current, dot, source);
}
