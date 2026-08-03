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
import type { Box, Diagram, Dot, DotSide, Extent, Point, Source } from "./diagram";
import { DOT_SEPARATION, dotsIn, placeOf } from "./diagram";
import { messageOf } from "./failure";
import { BOX_INK, INK } from "./palette";
import type { GlyphRun } from "./typesetting";
import { typesetLatex, UNITS_PER_EM } from "./typesetting";

/** Type size of a label on the diagram, in diagram units. */
const LABEL_EM = 24;

/** Room a label is given inside a box's walls, in diagram units. */
const LABEL_PADDING = 8;

/**
 * Room a term-dot's label keeps clear of the dot it names, in diagram units.
 *
 * Measured from the dot's edge rather than its centre, so a label stands the
 * same distance off however much ink a dot is drawn with. This backend's own,
 * the model naming no size for a dot and no distance for its label.
 */
const DOT_LABEL_GAP = 4;

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

  const boxLabel = drawLabel(box.source, boxLabelOrigin(box), "box-label", BOX_INK);
  if (boxLabel) {
    group.append(boxLabel);
  }
  for (const dot of dots) {
    const at = placeOf(box, dot);
    group.append(drawDot(at));
    const dotLabel = drawDotLabel(dot, at);
    if (dotLabel) {
      group.append(dotLabel);
    }
  }
  return group;
}

/** A term-dot: the `<circle>` standing for a term, where the model puts it. */
function drawDot(at: Point): SVGCircleElement {
  const mark = document.createElementNS(SVG_NS, "circle");
  mark.classList.add("term-dot");
  mark.setAttribute("cx", String(at.x));
  mark.setAttribute("cy", String(at.y));
  mark.setAttribute("r", String(DOT_RADIUS));
  mark.setAttribute("fill", INK);
  return mark;
}

/**
 * A term-dot's own label, or nothing where it has never been named — a dot
 * carries its source and its side together or not at all, which is what makes
 * "unnamed" one state rather than two.
 */
function drawDotLabel(dot: Dot, at: Point): SVGGElement | undefined {
  const { source, labelSide } = dot;
  return source === undefined || labelSide === undefined
    ? undefined
    : drawLabel(source, dotLabelOrigin(at, labelSide), "dot-label", INK);
}

/**
 * The label `source` was set to, put where `origin` says — or nothing, where it
 * has not been set.
 *
 * Drawing is synchronous and typesetting is not, so a label can only be drawn
 * from a run already set. Everything a gesture put in the diagram is: nothing
 * enters by being typed until this backend has set it. What is left is a source
 * read from a file and not yet set, or one that would not set at all, and drawn
 * unlabelled is what both are meant to look like.
 *
 * `origin` is asked for the run because where a label goes depends on how big
 * it is, and only a run already in hand can say.
 */
function drawLabel(
  source: Source,
  origin: (run: GlyphRun) => Point,
  className: string,
  ink: string,
): SVGGElement | undefined {
  const run = runs.get(source);
  if (run === undefined || run instanceof Error) {
    return undefined;
  }

  const label = document.createElementNS(SVG_NS, "g");
  label.classList.add(className);
  label.setAttribute("color", ink);
  // A copy: the cache holds one run however many labels are set from it, and a
  // node can only be in one place.
  label.append(run.glyphs.cloneNode(true));

  const at = origin(run);
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
function boxLabelOrigin(box: Box): (run: GlyphRun) => Point {
  return (run) => {
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
  };
}

/**
 * Where the run's left baseline point goes, for the side of the dot its label
 * takes.
 *
 * A dot is a point with no direction of its own, so the four sides are
 * absolute. Beside the dot the run is centred on the dot's own line — between
 * the top of its tallest glyph and the bottom of its deepest, rather than on
 * the baseline, which would sit a subscript's descender across the dot; above
 * or below it is centred across the dot and cleared by the edge the glyphs
 * would meet. The dot's own ink is what is cleared, {@link DOT_LABEL_GAP} being
 * the room kept beyond it.
 */
function dotLabelOrigin(at: Point, side: DotSide): (run: GlyphRun) => Point {
  return (run) => {
    const clear = DOT_RADIUS + DOT_LABEL_GAP;
    const middle = at.y - (toUnits(run.ascent) - toUnits(run.depth)) / 2;
    switch (side) {
      case "left":
        return { x: at.x - clear - toUnits(run.width), y: middle };
      case "right":
        return { x: at.x + clear, y: middle };
      case "above":
        return { x: at.x - toUnits(run.width) / 2, y: at.y + clear + toUnits(run.depth) };
      case "below":
        return { x: at.x - toUnits(run.width) / 2, y: at.y - clear - toUnits(run.ascent) };
    }
  };
}

/**
 * What each source has been set to: its glyph run, or the refusal there was
 * instead.
 *
 * The backend owns typesetting and its cache, with nothing injected into the
 * model. A redraw rebuilds every label, so without this the engine would run
 * once per label per frame — and a source that will not set is remembered as
 * such for the same reason, or every redraw would retry it and report it again.
 * The refusal is kept as the refusal rather than as a note about one, so
 * whoever asks next is told exactly what the first caller was.
 */
const runs = new Map<Source, GlyphRun | Error>();

/** Set `source` now, whatever is remembered of it, and remember what it comes to. */
async function setNow(source: Source): Promise<GlyphRun | Error> {
  const settled = await typesetLatex(source).catch(
    (failure: unknown) => new Error(messageOf(failure)),
  );
  runs.set(source, settled);
  return settled;
}

/** What `source` came to, setting it if it never has been set before. */
async function runOf(source: Source): Promise<GlyphRun | Error> {
  return runs.get(source) ?? (await setNow(source));
}

/**
 * The run `source` sets to, or a rejection carrying the reason it will not.
 *
 * A refusal already remembered is asked *again* rather than replayed, which is
 * what tells this door from {@link runOf}: someone submitting the same source a
 * second time is asking for exactly that, and a boot the engine got wrong once
 * would otherwise leave that source unsettable for the rest of the session. A
 * redraw asks nothing and takes the remembered answer.
 */
async function mustSet(source: Source): Promise<GlyphRun> {
  const known = runs.get(source);
  const run = known === undefined || known instanceof Error ? await setNow(source) : known;
  if (run instanceof Error) {
    throw run;
  }
  return run;
}

/**
 * Set `source`, rejecting where this backend cannot.
 *
 * The vetting a gesture does before a source enters the diagram: nothing typed
 * puts a source there that this backend cannot draw, so what is refused stays
 * in the input to be corrected rather than becoming a mark with no label.
 *
 * It hands back nothing. What setting a source produces is glyph geometry, and
 * that never leaves this backend — the caller asked whether the source can be
 * drawn, not for the drawing.
 */
export async function vetSource(source: Source): Promise<void> {
  await mustSet(source);
}

/** A source that would not set, and what the typesetter said of it. */
export interface Unset {
  readonly source: Source;
  readonly why: string;
}

/**
 * Set every source in `diagram` that has never been set, and hand back the ones
 * that would not set.
 *
 * Nothing is drawn: what this settles shows on the next redraw, which the
 * caller owns. For a drawing this editor's own gestures made there is nothing
 * left to set and nothing to report, every source having been vetted on the way
 * in — this is the road a diagram nothing here constructed arrives by, whose
 * LaTeX no form ever saw. Such a source costs its own label and no more: the
 * box or dot still draws, the source stays in the diagram to be corrected, and
 * what could not be set is named here.
 *
 * Sources are set one after another rather than all at once, so a source two
 * marks share is set once.
 */
export async function setLabelsOf(diagram: Diagram): Promise<readonly Unset[]> {
  const unset: Unset[] = [];
  for (const source of sourcesOf(diagram)) {
    const run = await runOf(source);
    if (run instanceof Error) {
      unset.push({ source, why: run.message });
    }
  }
  return unset;
}

/** Every source the diagram holds a label this backend draws from. */
function sourcesOf(diagram: Diagram): readonly Source[] {
  return [
    ...diagram.boxes.map((box) => box.source),
    ...diagram.dots.flatMap((dot) => (dot.source === undefined ? [] : [dot.source])),
  ];
}

/**
 * The smallest extent a box can hold `source` in.
 *
 * The floor a drag is measured against, and the one thing only this backend can
 * answer: a transition takes an extent already floored, so the asynchrony and
 * the two ways typesetting can fail stay out here.
 */
export async function measureBox(source: Source): Promise<Pick<Extent, "w" | "h">> {
  const run = await mustSet(source);
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
