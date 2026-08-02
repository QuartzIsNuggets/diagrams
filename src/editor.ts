// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The editor shell: it holds the current diagram and drives the two things that
// act on one — the transitions that take it to the next diagram, and the backend
// that draws it. Nothing here is the document. What is on screen is on screen
// because the diagram holds it, and a gesture that changes the drawing does so
// by making the next diagram, never by appending to the canvas.

import type { Diagram, Extent, Point, Refusal } from "./diagram";
import { addBox, addDot, boxAt, EMPTY_DIAGRAM } from "./diagram";
import { messageOf } from "./failure";
import { askForSource, clearSource } from "./label-form";
import { clearChrome, enableDragging, measureBox, renderDiagram, toPagePoint } from "./render-svg";

/**
 * The editor — the canvas, and the region a refused gesture is reported in —
 * wired and ready to append.
 *
 * `form` is the one place LaTeX is typed: the shell sends it to the box being
 * made and takes the source back from it, which is all either knows of the
 * other. It comes back already listening, there being no useful moment between
 * a canvas and a canvas that draws.
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
 * The diagram a plop leaves, or the one handed in where the model would not have
 * the dot — which the region is told, a refusal that says nothing being
 * indistinguishable from a gesture that broke.
 *
 * No question and nothing to await: a dot is placed before it is named, so the
 * whole of that gesture is this one transition.
 */
function plopped(diagram: Diagram, at: Point, refusal: HTMLParagraphElement): Diagram {
  const next = addDot(diagram, at);
  if (typeof next === "string") {
    refusal.textContent = REFUSALS[next];
    return diagram;
  }
  refusal.textContent = "";
  return next;
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
  let current = EMPTY_DIAGRAM;
  let naming = false;
  let making: "box" | "dot" = "box";
  renderDiagram(canvas, current);

  enableDragging(
    canvas,
    (at) => {
      if (naming) {
        return "no-gesture";
      }
      making = boxAt(current, at) ? "dot" : "box";
      // A dot has no extent to show: a rectangle following the pointer would
      // say a box was coming.
      return making === "box" ? "rectangle" : "nothing";
    },
    (drag, at) => {
      if (making === "dot") {
        current = plopped(current, at, refusal);
        renderDiagram(canvas, current);
        return;
      }
      naming = true;
      void nameIt(drag);
    },
  );

  /** Run the naming out, and draw whatever it settles on. */
  async function nameIt(drag: Extent): Promise<void> {
    try {
      current = await boxFrom(canvas, form, current, drag);
      renderDiagram(canvas, current);
      // A message stands for the last attempt, so anything that is not a
      // refusal — a box made, a question given up on — empties the region.
      refusal.textContent = "";
    } catch (failure: unknown) {
      refusal.textContent = messageOf(failure);
    } finally {
      // However it went, the gesture is over: its rectangle goes, and the next
      // press is free to start another.
      clearChrome(canvas);
      naming = false;
    }
  }
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
async function boxFrom(
  canvas: SVGSVGElement,
  form: HTMLFormElement,
  diagram: Diagram,
  drag: Extent,
): Promise<Diagram> {
  // At the label slot a new box takes, so a source is typed where the label it
  // becomes will be.
  const slot = toPagePoint(canvas, { x: drag.x, y: drag.y + drag.h / 2 });
  const source = await askForSource(form, slot);
  if (!source) {
    return diagram;
  }

  const floor = await measureBox(source);
  clearSource(form);
  return addBox(diagram, {
    source,
    x: drag.x,
    y: drag.y,
    w: Math.max(drag.w, floor.w),
    h: Math.max(drag.h, floor.h),
  });
}
