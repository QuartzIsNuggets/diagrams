// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The diagram: what one is, what a point in it lands inside, and how one
// becomes the next. No reader, no validator, no serializer — those arrive with
// Save, which is the only thing that can receive a file it did not construct.
//
// A diagram is a value. A transition returns the next one and leaves the one it
// was handed alone, which is what lets a shell hold *current* and what will make
// undo a stack of past values rather than a log of inverses.
//
// The shape here is the shape of the saved file, field for field, so that saving
// is a serialization rather than a reshape. The file's format version is the one
// exception: nothing in memory reads it, so nothing in memory holds it.
//
// What the types refuse, they refuse for one of two reasons. A structural rule
// becomes unforgeable when a single writable place can hold it. A meaningless
// one — a mark with nothing to mean — has nowhere to be written at all. What a
// drawing can get *wrong* rather than mean nothing by stays representable, for
// the checking layer to read.

declare const brand: unique symbol;

/**
 * Which of the five tables an id belongs to.
 *
 * This module's own word, and deliberately not `kind`, which the glossary
 * reserves for telling a path from an arrow: these are five where that is two,
 * and one word doing both jobs would read as the same question twice.
 */
type Sort = "box" | "dot" | "path" | "arrow" | "equivalence";

/**
 * An id: an integer, and the one sort of thing it may name.
 *
 * The integer is all that exists at run time. One id space is shared across all
 * five sorts, because anchor references are polymorphic — a path may point at a
 * path — so per-sort counters would leave a reference to `3` ambiguous. The
 * brand is what keeps that one space from being a free-for-all, and it costs
 * nothing to carry; a saved file records no sort either, a row's sort being
 * implied by the array it sits in.
 */
type Id<S extends Sort> = number & { readonly [brand]: S };

export type BoxId = Id<"box">;
export type DotId = Id<"dot">;
export type PathId = Id<"path">;
export type ArrowId = Id<"arrow">;
export type EquivalenceId = Id<"equivalence">;

/**
 * What a path or an arrow may attach to.
 *
 * The recursion is ordinary rather than a special case. A box is missing by
 * construction, which is the whole of "a box is never an anchor": there is
 * nowhere to write one down.
 */
export type AnchorId = DotId | PathId | ArrowId;

/**
 * Fields written together or not at all.
 *
 * Half of a pair whose members mean something only jointly is not a lesser value
 * but an incoherent one — a placement for a label that does not exist, a bend
 * with no size. Present as a pair, or absent as one.
 */
type BothOrNeither<T> = T | { readonly [K in keyof T]?: undefined };

/** The LaTeX a label is typeset from. */
export type Source = string;

/** Where a box's label sits: the six slots, written as the product they are. */
export type LabelSlot = `${"top" | "bottom"}-${"left" | "center" | "right"}`;

/**
 * Which side of a path or an arrow its label sits on, as you walk it from start
 * to end — taking the side from the direction is what lets it survive the ends
 * moving, where an absolute side has no answer for a vertical element or a loop.
 */
export type ElementSide = "left" | "right";

/**
 * Which side of a term-dot its label sits on, absolutely: a dot is a point, with
 * no direction to take a side relative to.
 *
 * Four is the smallest set the reference drawings need. Offering more, corners
 * included, is additive and settles where a dot can first be labelled.
 */
export type DotSide = "left" | "right" | "above" | "below";

/** A place in the diagram, measured in diagram units with the y-axis up. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A rectangle: its centre, and its full extent about that centre.
 *
 * A centre rather than a corner, so no corner has to be agreed on and the
 * y-axis pointing up costs a rectangle nothing.
 */
export interface Extent extends Point {
  readonly w: number;
  readonly h: number;
}

/**
 * A type, drawn as a rectangle labelled with its type expression.
 *
 * The extent is the box's own rather than fitted to its label, since a label's
 * size stops being knowable to the editor the moment a backend re-typesets it in
 * the document including it. It arrives already floored to hold its label, that
 * being a measurement only a backend can make.
 */
export interface Box extends Extent {
  readonly id: BoxId;
  readonly source: Source;
  readonly labelSlot: LabelSlot;
}

/**
 * A term-dot's label: a source and the side it sits on, or neither.
 *
 * Optional because a dot is placed before it is named — the gesture that puts
 * one down asks for nothing — and a side alone would place a label that does not
 * exist. A path's and an arrow's labels are not optional in the same way.
 */
type DotLabel = BothOrNeither<{ readonly source: Source; readonly labelSide: DotSide }>;

/**
 * A term, drawn as a dot inside the box of its type.
 *
 * `x` and `y` are relative to that box's centre, so moving the box carries its
 * dots with no bookkeeping. Membership sits here and only here — a box does not
 * list its dots — which leaves "in two boxes" and "orphaned while the box
 * disowns it" with nowhere to be written down.
 */
export type Dot = {
  readonly id: DotId;
  readonly box: BoxId;
  readonly x: number;
  readonly y: number;
} & DotLabel;

/**
 * A self-path's own bend: a direction in radians counter-clockwise from the
 * x-axis, and a size in diagram units.
 *
 * The one shape a drawing stores, a path whose ends coincide having no baseline
 * to bend relative to. That the pair belongs to a self-path and to nothing else
 * is `a === b`, which no type can say, so it is at least held as a pair.
 */
type Loop = BothOrNeither<{ readonly loopDirection: number; readonly loopSize: number }>;

/**
 * An identity proof between two anchors, running from `a` to `b`.
 *
 * `labelT` is how far along that run the label sits: a fraction, 0 at `a` and 1
 * at `b`, so it survives the ends moving as the side does. No other shape is
 * stored — a lone path is straight and one in a fan bows aside by its place in
 * that fan, both derived from the anchors.
 */
export type Path = {
  readonly id: PathId;
  readonly a: AnchorId;
  readonly b: AnchorId;
  readonly source: Source;
  readonly labelT: number;
  readonly labelSide: ElementSide;
  readonly conclusion: boolean;
} & Loop;

/**
 * What an arrow is, and — for the one that can be — whether it concludes.
 *
 * A built-in rule is meta-theoretic, so marking it the theorem's conclusion is
 * not a wrong drawing but a meaningless one: the mark has nothing to mean. The
 * field is therefore absent from that arm rather than checked. Spelling out
 * `conclusion?: undefined` is what makes the arm refuse a spread as firmly as it
 * refuses a literal, excess-property checking reaching only the latter.
 */
type ArrowRole =
  | { readonly role: "in-theory"; readonly conclusion: boolean }
  | { readonly role: "built-in"; readonly conclusion?: undefined };

/**
 * A function carrying anchors to an anchor.
 *
 * Many-to-one and held flat rather than curried, because a function has one
 * output. The inputs are ordered — `Σ-intro` on `(a, b)` is not the drawing
 * `(b, a)` — and never empty, an arrow carrying nothing having nothing to carry.
 * `labelT` runs along the output segment, junction to output: the one segment
 * every arrow has exactly one of, the junction itself being derived and nameless.
 */
export type Arrow = {
  readonly id: ArrowId;
  readonly inputs: readonly [AnchorId, ...AnchorId[]];
  readonly output: AnchorId;
  readonly source: Source;
  readonly labelT: number;
  readonly labelSide: ElementSide;
} & ArrowRole;

/**
 * `≈`, marking that a back-and-forth pair of arrows are mutually inverse.
 *
 * Exactly two arrows, and the count is the type's rather than a check. It has no
 * source — `≈` is its glyph and there is nothing else to write on it — and no
 * placement, standing where the two arrows put it.
 *
 * That those arrows must be *opposed* is a wrong drawing rather than a
 * meaningless one, and stays representable for the checking layer.
 */
export interface Equivalence {
  readonly id: EquivalenceId;
  readonly arrows: readonly [ArrowId, ArrowId];
  readonly conclusion: boolean;
}

/**
 * One proof drawing: a value, complete in itself, holding no reference to any
 * other diagram.
 *
 * Flat and id-keyed, nothing nesting, because the reference graph is not a tree:
 * one path can be an endpoint of several other paths and arrows at once, so
 * nesting would duplicate rows or fall back to ids anyway. `nextId` is the root
 * counter every id comes off, so no id is ever reused.
 */
export interface Diagram {
  readonly nextId: number;
  readonly boxes: readonly Box[];
  readonly dots: readonly Dot[];
  readonly paths: readonly Path[];
  readonly arrows: readonly Arrow[];
  readonly equivalences: readonly Equivalence[];
}

/** A diagram with nothing drawn in it, and no id yet spent. */
export const EMPTY_DIAGRAM: Diagram = {
  nextId: 1,
  boxes: [],
  dots: [],
  paths: [],
  arrows: [],
  equivalences: [],
};

/**
 * Take the next id for a `sort` of thing, and the diagram that has spent it.
 *
 * The one door onto the counter, and the only place a branded id is made — so
 * "assigned in creation order, never reused" holds by there being no other way
 * to get one. The diagram handed in comes back untouched.
 *
 * The sort decides which id comes back and nothing else: it spends no part of
 * the counter of its own, and the counter runs on past it either way.
 */
export function takeId<S extends Sort>(diagram: Diagram, _sort: S): readonly [Id<S>, Diagram] {
  return [diagram.nextId as Id<S>, { ...diagram, nextId: diagram.nextId + 1 }];
}

/**
 * Which box a point falls in, if any.
 *
 * The diagram owns every extent, so it answers this itself and no caller needs
 * a laid-out page — or a drawing to read back — to ask. Boxes never overlap, so
 * there is at most one answer; a point on a shared edge takes the earlier box,
 * which is arbitrary and harmless, no gesture caring which side of a wall it is
 * on.
 */
export function boxAt(diagram: Diagram, at: Point): Box | undefined {
  return diagram.boxes.find(
    (box) => Math.abs(at.x - box.x) <= box.w / 2 && Math.abs(at.y - box.y) <= box.h / 2,
  );
}

/**
 * What a gesture supplies for a new box: where it goes and how big, and the
 * source it is labelled with. Creation owns the rest.
 */
export type NewBox = Omit<Box, "id" | "labelSlot">;

/** Where a new box's label sits, until the user drags it elsewhere. */
const NEW_BOX_SLOT: LabelSlot = "top-center";

/**
 * The room a box keeps clear of every other, in diagram units.
 *
 * Boxes stand apart rather than merely not overlapping. Two walls flush against
 * each other read as one figure with a line through it, and the notation has
 * nothing to mean by a shared edge — boxes stand in no relationship to one
 * another — so the drawing has to say they are two. Room-making measures every
 * pair as though their extents were this much larger, which is the whole of it:
 * a box comes to rest exactly this far from the one that pushed it, and a box
 * this far from its neighbours is not in the way.
 *
 * The number is the model's rather than any backend's. How much air a drawing
 * keeps between its types is the same claim on screen and in TikZ, where a
 * wall's thickness and the room a label is given inside one are each backend's
 * own. It is a placeholder until a drawing argues for another.
 */
export const BOX_CLEARANCE = 12;

/**
 * A shortfall thinner than this is floating-point dust, not a box in the way.
 *
 * Displacing by exactly the shortfall leaves the pair a clearance apart *in
 * exact arithmetic*; in binary it can leave a last bit of it, and re-displacing
 * by that bit is a step that never lands.
 */
const TOUCHING = 1e-9;

/**
 * Put a box in the diagram, and the diagram that has it.
 *
 * The extent handed in is already floored to its label — the backend is the
 * only thing that can measure one, so the floor is settled before the
 * transition is called and this stays pure and synchronous.
 *
 * Creation is never refused for want of room: a box needing space another holds
 * pushes it aside, space being the box's extent and the {@link BOX_CLEARANCE}
 * around it. So a drag released across a box evicts it rather than being turned
 * away, and a box grown to fit a label the user could not see in advance still
 * lands.
 */
export function addBox(diagram: Diagram, box: NewBox): Diagram {
  const [id, spent] = takeId(diagram, "box");
  const placed: Box = { ...box, id, labelSlot: NEW_BOX_SLOT };
  return { ...spent, boxes: makeRoom([...spent.boxes, placed], placed) };
}

/**
 * How many sweeps a diagram gets to settle before the boxes are left as they lie.
 *
 * A sweep leaves nothing crowded except, now and then, against the grower —
 * which cannot give way — so it is run again and the fixed box pushes those out.
 * At the density an editor produces that is one sweep, occasionally two. The
 * bound is here because a packing tight enough can cycle instead, and a rule the
 * model runs has to come back.
 */
const SETTLING_SWEEPS = 20;

/**
 * Move whatever `grower` is in the way of, and whatever they are in turn, until
 * every box stands clear of every other.
 *
 * **The grower itself never moves.** It is the rectangle the user just drew, and
 * a box coming to rest anywhere else would make the mark they were looking at a
 * lie — so a drag across an existing box evicts it rather than being nudged off
 * it. Every other box gives way, and one wedged against the grower is pushed off
 * it by the sweep after.
 *
 * It cannot fail, because nothing bounds the plane — the export's frame is
 * derived from what is drawn.
 *
 * Alignment is not preserved: a box in the same column as a displaced one, but
 * not itself in the way, stays put, so a neat column can go ragged. The trade is
 * for never refusing a box, and the row order is left alone so ids stay sorted.
 */
function makeRoom(boxes: readonly Box[], grower: Box): readonly Box[] {
  let placed = boxes;
  for (let sweep = 0; sweep < SETTLING_SWEEPS && crowded(placed); sweep += 1) {
    placed = sweepFrom(placed, grower);
  }
  return placed;
}

/** Whether any two boxes are inside each other's room. */
function crowded(boxes: readonly Box[]): boolean {
  return boxes.some((box, index) =>
    boxes.slice(index + 1).some((other) => shortfallOf(box, other) !== undefined),
  );
}

/**
 * One breadth-first sweep out from the grower: each box in the way slides clear
 * of the one pushing it, and then pushes its own neighbours in turn.
 */
function sweepFrom(boxes: readonly Box[], grower: Box): readonly Box[] {
  const placed = new Map(boxes.map((box) => [box.id, box]));
  // The queue is walked as it grows: a box pushed here is a pusher further down.
  const queue: Box[] = [grower];
  for (const queued of queue) {
    // Re-read it — a box queued as a pusher may have been pushed since.
    const pusher = placed.get(queued.id) ?? queued;
    for (const other of placed.values()) {
      const moved =
        other.id === pusher.id || other.id === grower.id
          ? undefined
          : displace(pusher, other, grower);
      if (moved) {
        placed.set(moved.id, moved);
        queue.push(moved);
      }
    }
  }
  return boxes.map((box) => placed.get(box.id) ?? box);
}

/**
 * How far short of standing clear two boxes are, on each axis — or nothing
 * where they are already a {@link BOX_CLEARANCE} apart, a shortfall thinner than
 * {@link TOUCHING} being arithmetic dust.
 *
 * The clearance enters here and nowhere else: overlapping and merely crowding
 * are one question, so every rule that asks it — whether a diagram has settled,
 * which boxes a grower displaces, how far each goes — takes the room between
 * boxes with it and none of them names it. It lands on both axes alike, so
 * which axis needs least is the axis that needed least before.
 */
function shortfallOf(one: Box, other: Box): Point | undefined {
  const x = (one.w + other.w) / 2 + BOX_CLEARANCE - Math.abs(other.x - one.x);
  const y = (one.h + other.h) / 2 + BOX_CLEARANCE - Math.abs(other.y - one.y);
  return x > TOUCHING && y > TOUCHING ? { x, y } : undefined;
}

/**
 * Slide `other` clear of `pusher`, or leave it where it is.
 *
 * It moves along **whichever axis needs least** — the smaller of the two
 * shortfalls — by exactly that much, and away from the box pushing it, which
 * leaves the pair a {@link BOX_CLEARANCE} apart on that axis. Least-axis is what
 * keeps grids grid-shaped without being told they are grids: a box in the same
 * row falls short by a sliver horizontally and by its full height vertically,
 * so it slides sideways rather than jumping a row.
 *
 * A tie goes to x. Ticket 02 puts a tier before that one — the axis that grew
 * more — which creation has no answer for, nothing having grown; it belongs to
 * whatever first widens a box already placed.
 */
function displace(pusher: Box, other: Box, grower: Box): Box | undefined {
  const shortfall = shortfallOf(pusher, other);
  if (!shortfall) {
    return undefined;
  }
  return shortfall.x <= shortfall.y
    ? { ...other, x: other.x + awayFrom(other.x, pusher.x, grower.x) * shortfall.x }
    : { ...other, y: other.y + awayFrom(other.y, pusher.y, grower.y) * shortfall.y };
}

/**
 * Which way a box gives way, on the axis it is giving way along: away from the
 * box pushing it, and where the two share that coordinate exactly, outward from
 * the grower.
 *
 * The direction has to come from the pusher, or a box between the grower and the
 * one shoving it would be driven further into it. But two boxes on one centre
 * leave no direction to take, and sending them both the same way — `+x`, as this
 * did — is what lets a cascade cycle: a box pushed onto another is sent back
 * toward the grower, which pushes it out again, forever, and
 * {@link SETTLING_SWEEPS} then returns a diagram with two boxes on top of each
 * other. Outward from the grower is the tie-break that keeps every displacement
 * outward, which is the whole reason the cascade terminates. Coincident with the
 * grower too, nothing is outward and `+x` is as good a direction as any.
 */
function awayFrom(box: number, pusher: number, grower: number): number {
  return Math.sign(box - pusher) || Math.sign(box - grower) || 1;
}
