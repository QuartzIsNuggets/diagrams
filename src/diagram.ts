// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The diagram, as a type and nothing else — no reader, no validator, no
// serializer. Those arrive with Save, which is the only thing that can receive a
// file it did not construct.
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

/**
 * A type, drawn as a rectangle labelled with its type expression.
 *
 * `x` and `y` are its centre and `w` and `h` its full extent, so no corner has
 * to be agreed on and the y-axis pointing up costs a box nothing. The extent is
 * the box's own rather than fitted to its label, since a label's size stops
 * being knowable to the editor the moment a backend re-typesets it in the
 * document including it; it is auto-fitted when the box is first placed, and the
 * user's from then on.
 */
export interface Box {
  readonly id: BoxId;
  readonly source: Source;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
