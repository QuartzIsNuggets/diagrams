// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The SVG render backend: it reads a diagram and draws it, and nothing reads the
// drawing back. The seam runs one way, so this is where pixels stop — pointer
// positions become diagram units here and travel no further as anything else,
// and the y-up flip happens here and nowhere else.
//
// Every number below is this backend's own. A diagram unit is one SVG user unit
// for now, the type a label is set in and the room it is given inside a box's
// walls are ink rather than meaning, and the TikZ emitter will pick its own.

import { SVG_NS } from "./canvas";
import type { Box, Diagram, Dot, Extent, Point, Source } from "./diagram";
import { DOT_SEPARATION, dotsIn, placeOf } from "./diagram";
import { BOX_INK, INK } from "./palette";
import type { GlyphRun } from "./typesetting";
import { typesetLatex, UNITS_PER_EM } from "./typesetting";

/** Type size of a label on the diagram, in diagram units. */
const LABEL_EM = 24;

/** Room a label is given inside a box's walls, in diagram units. */
const LABEL_PADDING = 8;

/** How thick a box's wall is drawn, in diagram units. */
const BOX_STROKE = 2;

/**
 * How big a term-dot is drawn: the largest the model's separation allows.
 *
 * Two dots exactly a {@link DOT_SEPARATION} apart touch at a point and no more,
 * so this is the most ink the constraint leaves room for. Taken from the model's
 * number rather than chosen beside it — the model names no size, and a backend
 * that picked one of its own could draw dots the model thinks stand clear
 * overlapping.
 */
const DOT_RADIUS = DOT_SEPARATION / 2;

/**
 * The y-up flip: the model's axis turned into SVG's, written once.
 *
 * The canvas's top-left corner is the origin, so the half-plane on show is the
 * one below it. Where the origin sits on screen is arbitrary until there is
 * panning to make it a stored offset, and leaving it at a corner is what keeps
 * the drawing a function of the diagram alone — no layout is read to draw, so a
 * resize can never leave what is drawn out of step with what a pointer converts
 * to. Anything drawn in diagram units hangs under a root carrying this, and
 * nothing carries it twice.
 */
const FLIP = "scale(1,-1)";

/** Font units to diagram units, at the one size labels are set in. */
function toUnits(fontUnits: number): number {
  return (fontUnits * LABEL_EM) / UNITS_PER_EM;
}

/**
 * Draw `diagram` into `canvas`, replacing whatever was drawn from it before.
 *
 * A redraw rebuilds: the drawing carries no state worth diffing, and a keyed
 * diff waits for something that has to survive a frame. Only what this backend
 * drew is replaced, so marks the canvas holds for other reasons stay put.
 */
export function renderDiagram(canvas: SVGSVGElement, diagram: Diagram): void {
  const root = document.createElementNS(SVG_NS, "g");
  root.classList.add("diagram");
  root.setAttribute("transform", FLIP);
  // Ink, never a pointer target: what a press lands inside is the diagram's
  // question to answer, so nothing is ever read back off the drawing.
  root.setAttribute("pointer-events", "none");
  for (const box of diagram.boxes) {
    root.append(drawBox(box, dotsIn(diagram, box)));
  }

  const before = canvas.querySelector("g.diagram");
  if (before) {
    before.replaceWith(root);
    return;
  }
  // Beneath whatever else the canvas holds, so marks over the diagram stay over it.
  canvas.prepend(root);
}

/**
 * A box: its walls, its label in the slot the box names, and the term-dots it
 * holds — one group per box, so the drawing is grouped the way the diagram is.
 *
 * Everything in it is drawn in the diagram's own coordinates, the group carrying
 * no transform of its own: that a dot's place is relative to its box is the
 * model's rule, and it is undone in the model, by `placeOf`.
 */
function drawBox(box: Box, dots: readonly Dot[]): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("box");

  const walls = document.createElementNS(SVG_NS, "rect");
  walls.setAttribute("x", String(box.x - box.w / 2));
  walls.setAttribute("y", String(box.y - box.h / 2));
  walls.setAttribute("width", String(box.w));
  walls.setAttribute("height", String(box.h));
  // Presentation attributes rather than page CSS: a serialized <svg> travels
  // without this document's stylesheet.
  walls.setAttribute("fill", "none");
  walls.setAttribute("stroke", BOX_INK);
  walls.setAttribute("stroke-width", String(BOX_STROKE));
  group.append(walls);

  const label = drawLabel(box);
  if (label) {
    group.append(label);
  }
  for (const dot of dots) {
    group.append(drawDot(box, dot));
  }
  return group;
}

/** A term-dot: the `<circle>` standing for a term, where the model puts it. */
function drawDot(box: Box, dot: Dot): SVGCircleElement {
  const at = placeOf(box, dot);
  const mark = document.createElementNS(SVG_NS, "circle");
  mark.classList.add("term-dot");
  mark.setAttribute("cx", String(at.x));
  mark.setAttribute("cy", String(at.y));
  mark.setAttribute("r", String(DOT_RADIUS));
  mark.setAttribute("fill", INK);
  return mark;
}

/**
 * A box's label, or nothing where its source has never been typeset.
 *
 * Drawing is synchronous and typesetting is not, so a label can only be drawn
 * from a run already measured — which every source a gesture put there is, the
 * gesture having had to measure it to floor the box. A source this backend
 * cannot draw is exactly the one that is never measured, and drawn unlabelled
 * is what it is meant to look like.
 */
function drawLabel(box: Box): SVGGElement | undefined {
  const run = measured.get(box.source);
  if (!run) {
    return undefined;
  }

  const label = document.createElementNS(SVG_NS, "g");
  label.classList.add("box-label");
  label.setAttribute("color", BOX_INK);
  // A copy: the cache holds one run however many boxes are set from it, and a
  // node can only be in one place.
  label.append(run.glyphs.cloneNode(true));

  const at = labelOrigin(box, run);
  const scale = LABEL_EM / UNITS_PER_EM;
  // Flipped back: glyph geometry expects the y-down frame it was made in, so
  // inside a y-up diagram it is turned the right way up again here.
  label.setAttribute(
    "transform",
    `translate(${String(at.x)},${String(at.y)}) scale(${String(scale)},${String(-scale)})`,
  );
  return label;
}

/**
 * Where the run's left baseline point goes, for the slot the box names.
 *
 * The label sits inside the walls with {@link LABEL_PADDING} to spare, which is
 * the same room the box was floored to hold — so a box is never too small for
 * its own label, whichever of the six slots it takes.
 */
function labelOrigin(box: Box, run: GlyphRun): Point {
  const width = toUnits(run.width);
  const left = box.x - box.w / 2 + LABEL_PADDING;
  const right = box.x + box.w / 2 - LABEL_PADDING;

  const x = box.labelSlot.endsWith("left")
    ? left
    : box.labelSlot.endsWith("right")
      ? right - width
      : box.x - width / 2;
  const y = box.labelSlot.startsWith("top")
    ? box.y + box.h / 2 - LABEL_PADDING - toUnits(run.ascent)
    : box.y - box.h / 2 + LABEL_PADDING + toUnits(run.depth);
  return { x, y };
}

/**
 * What each source typeset to.
 *
 * The backend owns typesetting and its cache, with nothing injected into the
 * model. A redraw rebuilds every label, so without this the engine would run
 * once per box per frame; and a gesture measures a source before there is a box
 * to draw it in, so the run is already here by the time anything draws it.
 */
const measured = new Map<Source, GlyphRun>();

/**
 * The smallest extent a box can hold `source` in.
 *
 * The floor a drag is measured against, and the one thing only this backend can
 * answer: a transition takes an extent already floored, so the asynchrony and
 * the two ways typesetting can fail stay out here.
 */
export async function measureBox(source: Source): Promise<Pick<Extent, "w" | "h">> {
  const known = measured.get(source);
  const run = known ?? (await typesetLatex(source));
  measured.set(source, run);
  return {
    w: toUnits(run.width) + 2 * LABEL_PADDING,
    h: toUnits(run.ascent + run.depth) + 2 * LABEL_PADDING,
  };
}

/**
 * Where a pointer is, in diagram units.
 *
 * The one crossing: a position arrives as viewport pixels and leaves as the
 * model's own measure, y pointing up. Read fresh each time, so the canvas moving
 * on the page is never something to keep in step with.
 */
function toDiagramPoint(canvas: SVGSVGElement, event: PointerEvent): Point {
  const { left, top } = canvas.getBoundingClientRect();
  return { x: event.clientX - left, y: top - event.clientY };
}

/** Where something sits on the page: the two coordinates CSS places it by. */
export interface PagePoint {
  readonly left: number;
  readonly top: number;
}

/**
 * Where a point in the diagram is on the page.
 *
 * The crossing back, for chrome that is not drawn on the canvas — an HTML input
 * sitting where the label it asks about will be.
 */
export function toPagePoint(canvas: SVGSVGElement, at: Point): PagePoint {
  const { left, top } = canvas.getBoundingClientRect();
  return { left: left + at.x, top: top - at.y };
}

/**
 * Draw the rectangle a box is being made in, replacing the one before it.
 *
 * Chrome, not diagram: it is a mark the gesture makes before it lands, so it is
 * drawn apart from what the diagram holds and never survives the gesture. It
 * takes its coordinates in diagram units all the same, the gesture having
 * nothing else to hand.
 */
function showProvisionalBox(canvas: SVGSVGElement, extent: Extent): void {
  const rect = canvas.querySelector("g.chrome > rect.provisional-box") ?? newProvisionalBox(canvas);
  rect.setAttribute("x", String(extent.x - extent.w / 2));
  rect.setAttribute("y", String(extent.y - extent.h / 2));
  rect.setAttribute("width", String(extent.w));
  rect.setAttribute("height", String(extent.h));
}

/** `PointerEvent.button` for the left mouse button — the one that draws. */
const PRIMARY_BUTTON = 0;

/**
 * What a gesture leaves on the canvas while it runs.
 *
 * The press settles this along with everything else it settles, and the shell is
 * what settles it: which mark is being made is the shell's to know, and how much
 * of it shows before it lands follows from that. All this backend owns is the
 * drawing of it.
 */
type Provisional = "rectangle" | "nothing";

/** What a press starts: a gesture showing one of those, or no gesture at all. */
export type Started = Provisional | "no-gesture";

/** A gesture in flight: where it began, and what it shows while it runs. */
interface Running {
  readonly from: Point;
  readonly shows: Provisional;
}

/**
 * Follow a press-drag-release across `canvas`, in diagram units.
 *
 * The press decides whether there is a gesture at all and what it shows while it
 * runs — `starts` is asked where it landed, and answers with nothing where the
 * press means nothing here — and the release decides where the gesture lands. So
 * no threshold tells a click from a drag: a click is a drag of no size, and what
 * it makes was settled before the pointer moved.
 *
 * `lands` is given both the rectangle the drag swept and the point it was let go
 * of, a gesture that makes a box wanting the first and one that places a dot the
 * second. A rectangle it drew is left standing where it lands, for `lands` to
 * take down when it is done with it.
 *
 * Move and release are watched on the window, ahead of anything on the canvas: a
 * drag has to be followed off the canvas and let go of anywhere, and the release
 * belongs to the gesture the press started rather than to whatever else was
 * listening for one.
 */
export function enableDragging(
  canvas: SVGSVGElement,
  starts: (at: Point) => Started,
  lands: (drag: Extent, at: Point) => void,
): void {
  let gesture: Running | undefined;

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    if (event.button !== PRIMARY_BUTTON) {
      return;
    }
    // Before asking what the press means, and whatever the answer: a press on
    // the canvas is never the start of a text selection. Left to the UA it is,
    // and the UA then owns the cursor for as long as the button is down and
    // paints an I-beam over the drag. `user-select: none` on the canvas does not
    // cover this — the anchor moves to the selectable page around it rather than
    // ceasing to exist, so the selection runs into the bar and the Export button.
    event.preventDefault();
    const at = toDiagramPoint(canvas, event);
    const shows = starts(at);
    if (shows === "no-gesture") {
      return;
    }
    gesture = { from: at, shows };
    showRunning(canvas, gesture, at);
  });

  window.addEventListener("pointermove", (event: PointerEvent) => {
    showRunning(canvas, gesture, toDiagramPoint(canvas, event));
  });

  window.addEventListener(
    "pointerup",
    (event: PointerEvent) => {
      if (!gesture || event.button !== PRIMARY_BUTTON) {
        return;
      }
      event.stopImmediatePropagation();
      const at = toDiagramPoint(canvas, event);
      const drag = extentBetween(gesture.from, at);
      showRunning(canvas, gesture, at);
      gesture = undefined;
      lands(drag, at);
    },
    { capture: true },
  );
}

/** How far a gesture has got, for one that shows anything at all. */
function showRunning(canvas: SVGSVGElement, gesture: Running | undefined, at: Point): void {
  if (gesture?.shows === "rectangle") {
    showProvisionalBox(canvas, extentBetween(gesture.from, at));
  }
}

/** The rectangle a drag between two points asks for. */
function extentBetween(from: Point, to: Point): Extent {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  };
}

/** Take back every provisional mark: the gesture has landed, or has not. */
export function clearChrome(canvas: SVGSVGElement): void {
  canvas.querySelector("g.chrome")?.remove();
}

function newProvisionalBox(canvas: SVGSVGElement): SVGRectElement {
  const chrome = document.createElementNS(SVG_NS, "g");
  chrome.classList.add("chrome");
  // The diagram's own frame, the gesture having nothing but diagram units to
  // draw in, and untouchable, so a provisional mark never eats its own release.
  chrome.setAttribute("transform", FLIP);
  chrome.setAttribute("pointer-events", "none");

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.classList.add("provisional-box");
  chrome.append(rect);
  // Over the diagram, which is what a provisional mark is asking about.
  canvas.append(chrome);
  return rect;
}
