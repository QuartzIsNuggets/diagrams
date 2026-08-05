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
import type { Started } from "./gesture";
import { enableGesture } from "./gesture";
import type { Unset } from "./label-store";
import { createLabelStore } from "./label-store";
import { BOX_INK, INK } from "./palette";
import type { GlyphRun } from "./typesetting";
import { UNITS_PER_EM } from "./typesetting";

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
 * Room kept between the outermost ink and the edge of an exported file, in
 * diagram units.
 *
 * This backend's own, like every other number here: how much air a drawing is
 * given in the file it is emitted as is a fact about the emitted file, and the
 * TikZ emitter will have its own answer. A placeholder until a drawing argues
 * for another.
 */
const EXPORT_MARGIN = 16;

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
 * What drawing a diagram comes to: the marks, and how much room each one takes.
 *
 * The extents are collected as the marks are made rather than measured
 * afterwards. Where a mark goes is worked out here anyway — a label's origin
 * needs its run's own metrics — so asking again later would be re-deriving what
 * was in hand, and asking a laid-out page would be reading the drawing back.
 */
interface Drawing {
  readonly root: SVGGElement;
  readonly extents: readonly Extent[];
}

/** Draw `diagram` under the one flip, in the diagram's own coordinates. */
function drawDiagram(diagram: Diagram): Drawing {
  const extents: Extent[] = [];
  const root = document.createElementNS(SVG_NS, "g");
  root.classList.add("diagram");
  root.setAttribute("transform", FLIP);
  for (const box of diagram.boxes) {
    root.append(drawBox(box, dotsIn(diagram, box), extents));
  }
  return { root, extents };
}

/**
 * Draw `diagram` into `canvas`, replacing whatever was drawn from it before.
 *
 * A redraw rebuilds: the drawing carries no state worth diffing, and a keyed
 * diff waits for something that has to survive a frame. Only what this backend
 * drew is replaced, so marks the canvas holds for other reasons stay put.
 */
export function renderDiagram(canvas: SVGSVGElement, diagram: Diagram): void {
  const { root } = drawDiagram(diagram);
  // Ink, never a pointer target: what a press lands inside is the diagram's
  // question to answer, so nothing is ever read back off the drawing. On screen
  // only — an exported file has no pointer to keep off it.
  root.setAttribute("pointer-events", "none");

  const before = canvas.querySelector("g.diagram");
  if (before) {
    before.replaceWith(root);
    return;
  }
  // Beneath whatever else the canvas holds, so marks over the diagram stay over it.
  canvas.prepend(root);
}

/**
 * Draw `diagram` as a document of its own, framed by what is drawn in it.
 *
 * The same marks the screen gets, in a document that is the drawing rather than
 * a window onto it: nothing here reads a layout, so a diagram comes out the same
 * file whatever size the window was — or whether there was a window at all. That
 * is what lets a batch caller emit one.
 *
 * It settles the diagram first, and is asynchronous for that reason alone. This
 * is where the two drawings part: a document is read once and keeps whatever
 * gaps it was written with, so a caller that never settled the diagram must not
 * be able to emit one short a name, where {@link renderDiagram} draws what is
 * set at once and is drawn again when the rest arrives.
 *
 * A source that will not set costs its own label here exactly as it does on
 * screen, and is not named on the way out: {@link setLabelsOf} is what reports
 * the sources a diagram brought and this backend would not take, and a document
 * standing for what is on screen is the honest answer for a caller that did not
 * ask it.
 *
 * The frame is stated in SVG's axis while the marks stay in the diagram's, the
 * root carrying the one {@link FLIP} between them.
 */
export async function drawDocument(diagram: Diagram): Promise<SVGSVGElement> {
  await setLabelsOf(diagram);
  const { root, extents } = drawDiagram(diagram);
  const frame = frameOf(extents);
  const left = frame.x - frame.w / 2;
  // The diagram's top edge, which the flip turns into the document's least y.
  const top = -(frame.y + frame.h / 2);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(frame.w));
  svg.setAttribute("height", String(frame.h));
  svg.setAttribute(
    "viewBox",
    `${String(left)} ${String(top)} ${String(frame.w)} ${String(frame.h)}`,
  );
  svg.append(root);
  return svg;
}

/**
 * What an exported file is framed to: the smallest extent holding every mark,
 * an {@link EXPORT_MARGIN} of air around it, and each edge then taken out to a
 * whole unit.
 *
 * Outward, so rounding only ever adds air and can never crop a mark. It is
 * worth doing because a frame is arithmetic on measured glyph metrics, and the
 * exact answer serializes as `10.79359999999997` — seventeen digits of float
 * noise in a file a person may open, standing for a fifth of a unit no renderer
 * can draw the difference of.
 *
 * A diagram with nothing in it has nothing to frame and comes out as that
 * margin alone about the origin — a small blank square, where the honest union
 * of nothing would be a document of no size, which no renderer can draw.
 */
function frameOf(extents: readonly Extent[]): Extent {
  const drawn = extents.length === 0 ? [{ x: 0, y: 0, w: 0, h: 0 }] : extents;
  const left = Math.floor(Math.min(...drawn.map((one) => one.x - one.w / 2)) - EXPORT_MARGIN);
  const right = Math.ceil(Math.max(...drawn.map((one) => one.x + one.w / 2)) + EXPORT_MARGIN);
  const bottom = Math.floor(Math.min(...drawn.map((one) => one.y - one.h / 2)) - EXPORT_MARGIN);
  const top = Math.ceil(Math.max(...drawn.map((one) => one.y + one.h / 2)) + EXPORT_MARGIN);
  return { x: (left + right) / 2, y: (bottom + top) / 2, w: right - left, h: top - bottom };
}

/**
 * A box: its walls, its label in the slot the box names, and the term-dots it
 * holds — one group per box, so the drawing is grouped the way the diagram is.
 *
 * Everything in it is drawn in the diagram's own coordinates, the group carrying
 * no transform of its own: that a dot's place is relative to its box is the
 * model's rule, and it is undone in the model, by `placeOf`.
 *
 * Every mark made adds its own extent to `extents`, walls included: a wall is
 * stroked astride the rectangle, so the box reaches half a {@link BOX_STROKE}
 * beyond the extent the model gave it.
 */
function drawBox(box: Box, dots: readonly Dot[], extents: Extent[]): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.classList.add("box");
  extents.push({ x: box.x, y: box.y, w: box.w + BOX_STROKE, h: box.h + BOX_STROKE });

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

  const boxLabel = drawLabel(box.source, boxLabelOrigin(box), "box-label", BOX_INK, extents);
  if (boxLabel) {
    group.append(boxLabel);
  }
  for (const dot of dots) {
    const at = placeOf(box, dot);
    group.append(drawDot(at, extents));
    const dotLabel = drawDotLabel(dot, at, extents);
    if (dotLabel) {
      group.append(dotLabel);
    }
  }
  return group;
}

/** A term-dot: the `<circle>` standing for a term, where the model puts it. */
function drawDot(at: Point, extents: Extent[]): SVGCircleElement {
  extents.push({ ...at, w: 2 * DOT_RADIUS, h: 2 * DOT_RADIUS });
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
function drawDotLabel(dot: Dot, at: Point, extents: Extent[]): SVGGElement | undefined {
  const { source, labelSide } = dot;
  return source === undefined || labelSide === undefined
    ? undefined
    : drawLabel(source, dotLabelOrigin(at, labelSide), "dot-label", INK, extents);
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
  extents: Extent[],
): SVGGElement | undefined {
  const run = labels.runOf(source);
  if (run === undefined) {
    return undefined;
  }

  const label = document.createElementNS(SVG_NS, "g");
  label.classList.add(className);
  label.setAttribute("color", ink);
  // A copy: one run is remembered however many labels are drawn from it, and a
  // node can only be in one place.
  label.append(run.glyphs.cloneNode(true));

  const at = origin(run);
  // The run stands on its left baseline point, so its extent is that point
  // offset by the metrics the engine measured. They are the typesetter's own
  // account of the room it takes rather than a bound on its outlines, which
  // nothing can read off path geometry without a page to measure on — the same
  // account the run was *placed* by, so the frame and the placement agree, and
  // the margin covers what a flourish may put beyond it.
  extents.push({
    x: at.x + toUnits(run.width) / 2,
    y: at.y + toUnits(run.ascent - run.depth) / 2,
    w: toUnits(run.width),
    h: toUnits(run.ascent + run.depth),
  });

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
 * What this backend has set, and what it remembers of the sources that would
 * not set.
 *
 * One store, and the backend's own: that it owns typesetting and what it
 * remembers is the same stance that keeps glyph geometry from reaching the
 * model, and nothing is injected into the shell. Why what a source came to is
 * remembered at all, and which acts may retry it, is the store's own to say.
 *
 * Everything below composes over it and adds this backend's own knowledge:
 * which of a diagram's marks carry a label, and how much room one is given
 * inside a box's walls.
 */
const labels = createLabelStore();

/**
 * Set `source`, rejecting where this backend cannot.
 *
 * The vetting the naming bar does before it will close: nothing typed puts a
 * source in a diagram that this backend cannot draw, so what is refused keeps
 * the bar open at its mark rather than becoming a mark with no label. An ask,
 * so a source refused once is asked again rather than held against the person
 * re-submitting it.
 *
 * It hands back nothing. What setting a source produces is glyph geometry, and
 * that never leaves this backend — the caller asked whether the source can be
 * drawn, not for the drawing.
 */
export async function vetSource(source: Source): Promise<void> {
  await labels.set(source);
}

// Passed straight through: what a source that would not set is called is the
// store's word, and a caller of this backend has no second one to learn.
export type { Unset };

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
 * Which sources a diagram holds a label from is the whole of what this adds to
 * a fill: a store is handed sources and knows nothing of boxes or dots.
 */
export async function setLabelsOf(diagram: Diagram): Promise<readonly Unset[]> {
  return await labels.setAll(sourcesOf(diagram));
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
 * the two ways typesetting can fail stay out here. An ask, and the room a label
 * is given inside the walls — which is this backend's alone, the store knowing
 * nothing of boxes.
 */
export async function measureBox(source: Source): Promise<Pick<Extent, "w" | "h">> {
  const run = await labels.set(source);
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
 * Draw the rectangle a box is being made in, replacing the one before it — or
 * take back every provisional mark, where there is nothing to show.
 *
 * Chrome, not diagram: it is a mark the gesture makes before it lands, so it is
 * drawn apart from what the diagram holds and never survives the gesture. It
 * takes its coordinates in diagram units all the same, the gesture having
 * nothing else to hand.
 */
function showProvisionalBox(canvas: SVGSVGElement, extent: Extent | undefined): void {
  if (extent === undefined) {
    canvas.querySelector("g.chrome")?.remove();
    return;
  }
  const rect = canvas.querySelector("g.chrome > rect.provisional-box") ?? newProvisionalBox(canvas);
  rect.setAttribute("x", String(extent.x - extent.w / 2));
  rect.setAttribute("y", String(extent.y - extent.h / 2));
  rect.setAttribute("width", String(extent.w));
  rect.setAttribute("height", String(extent.h));
}

/**
 * Let a gesture on `canvas` draw, in diagram units.
 *
 * The two things a gesture cannot know, and the whole of what this backend adds
 * to one: where a pointer is on the plane the diagram is measured in, and what a
 * rectangle following it looks like. Both stay private — that is the point of
 * composing over {@link enableGesture} rather than exporting the parts.
 *
 * Nothing to show is nothing left standing: a gesture showing no rectangle draws
 * none, and one that is done with the rectangle it drew has it taken down by the
 * same call that put it up.
 */
export function enableDragging(
  canvas: SVGSVGElement,
  starts: (at: Point) => Started,
  lands: (drag: Extent, at: Point, displaced: () => boolean) => Promise<void>,
): void {
  enableGesture(
    canvas,
    (event) => toDiagramPoint(canvas, event),
    (drag) => {
      showProvisionalBox(canvas, drag);
    },
    starts,
    lands,
  );
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
