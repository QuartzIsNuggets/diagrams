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

/** What `show` is handed where there is nothing to show, and nothing to stand. */
const NOTHING_SHOWING = undefined;

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
  return gesture?.shows === "rectangle" ? extentBetween(gesture.from, to) : NOTHING_SHOWING;
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
 * `show` is handed the rectangle the drag has swept so far, or nothing — the
 * press having settled which, so a caller is told either way rather than keeping
 * its own copy of that answer. Nothing showing is nothing left standing: what a
 * press shows replaces whatever is on screen, whoever put it there, so a caller
 * that wants a mark to outlive its own gesture has to refuse the presses that
 * would replace it while it stands.
 *
 * `lands` is given both the rectangle and the point the pointer was let go of, a
 * gesture that makes a box wanting the first and one that places a dot the
 * second, and it hands back the naming it asks for: the mark stands until that
 * settles, and then the gesture takes down what it put up. However it settled — a
 * naming that failed leaves no more of a question open than one given up on, and
 * the failure is the caller's to have, so it is let through rather than swallowed
 * here while the mark comes down all the same.
 *
 * Unless a press has begun another gesture meanwhile, which is what `lands` is
 * handed `displaced` for. A naming a press gave up on comes back **late** — that
 * press has started the next gesture, which may already have a mark of its own on
 * the canvas — so a gesture clearing on the way out would wipe the mark the
 * gesture running now is asking about. The gestures are counted here, this being
 * where the presses that begin them arrive, and the count answers the one
 * question a late landing has: is what is showing still mine? Everything the
 * landing was going to undo hangs on that, so the caller is handed the same
 * answer rather than keeping a second count in step with this one. A press
 * `starts` refuses counts for nothing, having begun no gesture to displace the
 * one still asking.
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
  lands: (drag: Extent, at: Point, displaced: () => boolean) => Promise<void>,
): void {
  let gesture: Running | undefined;
  // How many have begun: an identity rather than a tally.
  let gestures = 0;

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
    show(showingOf(gesture, to));
    gesture = undefined;
    window.removeEventListener("pointermove", follow);
    window.removeEventListener("pointerup", finish, AHEAD);
    const mine = gestures;
    const displaced = (): boolean => gestures !== mine;
    // Asked for from inside a promise, so a naming that throws where it should
    // have rejected still settled, and what is showing comes down either way — a
    // mark nothing is asking about being a dead one. The question is still asked
    // as the release is read: an async function runs to its first `await`, and
    // the ask is what that await is on.
    void (async () => await lands(drag, to, displaced))().finally(() => {
      if (!displaced()) {
        show(NOTHING_SHOWING);
      }
    });
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
    gestures += 1;
    show(showingOf(gesture, from));
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", finish, AHEAD);
  });
}
