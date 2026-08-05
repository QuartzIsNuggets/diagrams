// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// A gesture: the press, the drag it may become, and the release that ends it.
//
// Nothing here draws and nothing here converts. The module is told where a
// pointer is and handed a way to show how far the drag has got, so the y-up
// flip, the scale and every mark's ink stay behind the render backend's
// interface and this imports nothing from one — following a pointer is no
// backend's, and a backend that emits a file rather than pixels has no pointer
// to follow at all.
//
// It knows a rectangle by name, which is all a caller saying *a box is coming*
// needs it to know, and nothing of how one is drawn.

import type { Extent, Point } from "./diagram";

/** `PointerEvent.button` for the left mouse button — the one that draws. */
const PRIMARY_BUTTON = 0;

/** How the release is watched for: ahead of anything else listening for one. */
const AHEAD = { capture: true } as const;

/**
 * What a gesture leaves on screen while it runs.
 *
 * The press settles this along with everything else it settles, and the caller
 * is what settles it: which mark is being made is the caller's to know, and how
 * much of it shows before it lands follows from that. All this module owns is
 * when to say so.
 */
type Provisional = "rectangle" | "nothing";

/** What a press starts: a gesture showing one of those, or no gesture at all. */
export type Started = Provisional | "no-gesture";

/** A gesture in flight: where it began, and what it shows while it runs. */
interface Running {
  readonly from: Point;
  readonly shows: Provisional;
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

/**
 * How far `gesture` has got, once its drag has reached `to` — or nothing, for a
 * gesture that shows no rectangle, and for no gesture at all.
 */
function showingOf(gesture: Running | undefined, to: Point): Extent | undefined {
  return gesture?.shows === "rectangle" ? extentBetween(gesture.from, to) : undefined;
}

/**
 * Follow a press–drag–release on `on`, in whatever measure `at` reports.
 *
 * The press decides whether there is a gesture at all and what it shows while it
 * runs — `starts` is asked where it landed, and answers with nothing where the
 * press means nothing there — and the release decides where the gesture lands. So
 * no threshold tells a click from a drag: a click is a drag of no size, and what
 * it makes was settled before the pointer moved.
 *
 * `show` is handed the rectangle the drag has swept so far, or nothing where the
 * gesture shows none — the press having settled which, so a caller is told either
 * way rather than keeping its own copy of that answer. `lands` is given both the
 * rectangle and the point the pointer was let go of, a gesture that makes a box
 * wanting the first and one that places a dot the second. What `show` was last
 * handed is left showing where the gesture lands, for `lands` to take down when
 * it is done with it.
 *
 * Move and release are watched on the window, ahead of anything on `on`, and only
 * while a drag is in flight: a drag has to be followed off the element and let go
 * of anywhere, which is so exactly while one is running, and the release belongs
 * to the gesture the press started rather than to whatever else was listening for
 * one. Watching from the press rather than from here is what puts a bound on
 * that claim: capture listeners run in the order they were added, so a release
 * is this gesture's ahead of everything but a window capture listener that was
 * already there when the press landed.
 */
export function enableGesture(
  on: Element,
  at: (event: PointerEvent) => Point,
  show: (drag: Extent | undefined) => void,
  starts: (at: Point) => Started,
  lands: (drag: Extent, at: Point) => void,
): void {
  let gesture: Running | undefined;

  function follow(event: PointerEvent): void {
    show(showingOf(gesture, at(event)));
  }

  function finish(event: PointerEvent): void {
    if (!gesture || event.button !== PRIMARY_BUTTON) {
      return;
    }
    event.stopImmediatePropagation();
    const to = at(event);
    const drag = extentBetween(gesture.from, to);
    show(gesture.shows === "rectangle" ? drag : undefined);
    gesture = undefined;
    window.removeEventListener("pointermove", follow);
    window.removeEventListener("pointerup", finish, AHEAD);
    lands(drag, to);
  }

  on.addEventListener("pointerdown", (event) => {
    // An `Element` is not a `GlobalEventHandlers`, so its listeners take a plain
    // `Event` — and taking the element as no more than one is the point here.
    const press = event as PointerEvent;
    if (press.button !== PRIMARY_BUTTON) {
      return;
    }
    // Whatever the press turns out to mean: it is never the start of a text
    // selection. Left to the UA it is, and the UA then owns the cursor while the
    // button is down and paints an I-beam over the drag. `user-select: none` on
    // the element does not cover this — the anchor moves to the page around it.
    press.preventDefault();
    const from = at(press);
    const shows = starts(from);
    if (shows === "no-gesture") {
      return;
    }
    gesture = { from, shows };
    show(showingOf(gesture, from));
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", finish, AHEAD);
  });
}
