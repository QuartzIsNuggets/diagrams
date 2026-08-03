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
import { askForSource } from "./naming-bar";
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
 * What an editor hands its page: the region to append, and the diagram it is
 * currently holding.
 *
 * A reader rather than the diagram itself, since the diagram it holds is a
 * different value after every gesture — whoever wants the drawing as it stands,
 * the export being the first, has to ask at the moment they want it. It is the
 * one way out of the shell, and it is read-only: nothing changes a diagram but
 * a gesture.
 */
export interface Editor {
  readonly region: HTMLDivElement;
  readonly diagramNow: () => Diagram;
}

/**
 * The editor — the canvas, and the region a refused gesture is reported in —
 * wired and ready to append.
 *
 * The naming bar is not among them: it is summoned at whatever is being named —
 * the rectangle a box is drawn in, the dot just plopped — and is gone once that
 * question is answered, so there is never a bar for a page to hold. The shell
 * asks for a source and takes one back, which is all either knows of the other.
 * The editor comes back already listening, there being no useful moment between
 * a canvas and a canvas that draws.
 */
export function createEditor(canvas: SVGSVGElement): Editor {
  const region = document.createElement("div");
  region.classList.add("editor");

  // In the tree before it has anything to say, so a refusal is announced rather
  // than appearing from nowhere. One region, not one per gesture: "why did
  // nothing appear?" is one question — and not the naming bar's question, which
  // is why a source that will not set is refused at the mark instead.
  const refusal = document.createElement("p");
  refusal.classList.add("canvas-error");
  refusal.setAttribute("role", "alert");

  region.append(canvas, refusal);
  const shell = enableDrawing(canvas, refusal);
  return { region, diagramNow: () => shell.current };
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
 * What a gesture acts on: the diagram on screen, what draws it, and where a
 * refusal is put.
 *
 * The one mutable thing the editor has. `current` is the document — every mark
 * on the canvas is there because it holds one — and `naming` says whether a bar
 * is already asking about a mark, since a second question would throw away the
 * first's typed source.
 */
interface Shell {
  readonly canvas: SVGSVGElement;
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
 * The one place a gesture ends, whichever mark it was making. Nothing is
 * reported here: a naming ends on a mark named or a question given up on, and
 * neither is a refusal — the source that would have been one never got past the
 * bar. So the region is emptied either way, a message standing for the last
 * attempt and this being it.
 */
async function named(shell: Shell, naming: Promise<Diagram>): Promise<void> {
  shell.current = await naming;
  draw(shell);
  shell.refusal.textContent = "";
  // The gesture is over: any rectangle it drew goes, and the next press is free
  // to start another. Not before — a rectangle is the mark its question is
  // about, so it stands as long as the bar is still asking about it.
  clearChrome(shell.canvas);
  shell.naming = false;
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
 * A press while a question is open starts nothing: one bar holds one question,
 * and a press that quietly cancelled it would throw away a typed source.
 *
 * The shell comes back so what is on screen can be read out of it.
 */
function enableDrawing(canvas: SVGSVGElement, refusal: HTMLParagraphElement): Shell {
  const shell: Shell = { canvas, refusal, current: EMPTY_DIAGRAM, naming: false };
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
  return shell;
}

/**
 * Ask for the box's type expression, and hand back the diagram that has the
 * box — or the one handed in, where the question was given up on.
 *
 * The rectangle stays up for as long as the bar does: it is what the question is
 * about, which is why the bar is summoned onto it rather than covering it, and
 * a source being corrected is still that question. Measuring the box is what
 * vets its source — a floor is what the drawing needs anyway, and a source that
 * has none is a source this backend will not set — so the bar keeps asking until
 * one comes back and nothing unmeasurable ever reaches a box.
 */
async function boxFrom(shell: Shell, drag: Extent): Promise<Diagram> {
  // At the label slot a new box takes, so a source is typed where the label it
  // becomes will be.
  const slot = toPagePoint(shell.canvas, { x: drag.x, y: drag.y + drag.h / 2 });
  const box = await askForSource(slot, async (source) => {
    const floor = await measureBox(source);
    return {
      source,
      x: drag.x,
      y: drag.y,
      w: Math.max(drag.w, floor.w),
      h: Math.max(drag.h, floor.h),
    };
  });
  return box ? addBox(shell.current, box) : shell.current;
}

/**
 * Ask what the dot just placed is called, and hand back the diagram that has it
 * named — or the one handed in, where the question was given up on.
 *
 * The bar goes to the dot itself rather than to where the glyphs will land: the
 * dot is the mark the question is about, and how far off it a label stands is
 * the backend's own. A dot has no extent to floor, so the source is vetted for
 * its own sake and the bar keeps asking until one sets — the dot standing
 * unnamed meanwhile, which it may do for good if the question is given up on.
 */
async function dotNamed(shell: Shell, dot: DotId, at: Point): Promise<Diagram> {
  const vetted = await askForSource(toPagePoint(shell.canvas, at), async (source) => {
    await vetSource(source);
    return source;
  });
  return vetted === undefined ? shell.current : labelDot(shell.current, dot, vetted);
}
