// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The editor shell: it holds the current diagram and drives the two things that
// act on one — the transitions that take it to the next diagram, and the backend
// that draws it. Nothing here is the document. What is on screen is on screen
// because the diagram holds it, and a gesture that changes the drawing does so
// by making the next diagram, never by appending to the canvas.

import type { Diagram, Extent } from "./diagram";
import { addBox, boxAt, EMPTY_DIAGRAM } from "./diagram";
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
  enableBoxMaking(canvas, form, refusal);
  return editor;
}

/**
 * Make a drag on empty canvas draw a box, and hold the diagram it goes into.
 *
 * The press decides what is being made: empty canvas is a box, and inside a box
 * is a term-dot, which the model does not hold yet and which nothing here
 * claims. Only the diagram can say which of the two a press landed on, and it
 * says so from the extents it holds rather than from anything drawn.
 */
function enableBoxMaking(
  canvas: SVGSVGElement,
  form: HTMLFormElement,
  refusal: HTMLParagraphElement,
): void {
  let current = EMPTY_DIAGRAM;
  // One question at a time: the input is already at a rectangle, and a second
  // press would leave the first with nothing to answer it.
  let naming = false;
  renderDiagram(canvas, current);

  enableDragging(
    canvas,
    (at) => !naming && !boxAt(current, at),
    (drag) => {
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
