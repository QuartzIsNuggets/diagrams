// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// What a press means, tested through the gesture's own interface: a plain
// element, a converter that invents its own measure, and a spy for what is
// shown. No canvas, no SVG and no layout stub, because none of that is the
// gesture's — where a pointer is in diagram units and what a rectangle is drawn
// as belong to the render backend, and are tested in render-svg.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Extent, Point } from "./diagram";
import type { Started } from "./gesture";
import { enableGesture } from "./gesture";

let element: HTMLElement;

/**
 * A converter of the gesture's own: page coordinates, halved.
 *
 * Not the identity, so a test that passes is one where the gesture asked rather
 * than one where it happened to read the same numbers off the event.
 */
function at(event: PointerEvent): Point {
  return { x: event.clientX / 2, y: event.clientY / 2 };
}

/**
 * A landing in hand: what the release handed it, and the naming it is waiting on.
 *
 * Every landing here stays open until a test settles it, which is what a real one
 * does — a naming is a question on screen — and what leaves a test free to press
 * again while the last gesture is still asking.
 */
interface Landing {
  readonly drag: Extent;
  readonly at: Point;
  readonly displaced: () => boolean;
  /** Let the naming come back, and let the gesture act on its coming back. */
  readonly settle: () => Promise<void>;
}

/** What a wired gesture hands on: what it showed, and what it landed. */
interface Wired {
  readonly shown: (Extent | undefined)[];
  readonly landed: Landing[];
}

function wire(starts: (at: Point) => Started = () => "rectangle"): Wired {
  const shown: (Extent | undefined)[] = [];
  const landed: Landing[] = [];
  enableGesture(
    element,
    at,
    (drag) => shown.push(drag),
    starts,
    async (drag, where, displaced) => {
      // Registered from inside the executor, which runs as the promise is made:
      // the landing is in hand, with the way to settle it, before it is awaited.
      await new Promise<void>((answer) => {
        landed.push({
          drag,
          at: where,
          displaced,
          settle: async () => {
            answer();
            await turn();
          },
        });
      });
    },
  );
  return { shown, landed };
}

/** Let what a settled naming set going run out: a turn of the event loop. */
async function turn(): Promise<void> {
  await new Promise((resume) => {
    setTimeout(resume, 0);
  });
}

function pressAt(clientX: number, clientY: number, button = 0): void {
  element.dispatchEvent(
    new PointerEvent("pointerdown", { clientX, clientY, button, bubbles: true }),
  );
}

function moveTo(clientX: number, clientY: number): void {
  element.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY, bubbles: true }));
}

function releaseAt(clientX: number, clientY: number, button = 0): void {
  element.dispatchEvent(new PointerEvent("pointerup", { clientX, clientY, button, bubbles: true }));
}

beforeEach(() => {
  element = document.createElement("div");
  document.body.replaceChildren(element);
});

describe("the rectangle a press–drag–release hands on", () => {
  it("runs between the press and the release, in the measure it was told", () => {
    const { landed } = wire();

    pressAt(100, 60);
    releaseAt(300, 260);

    expect([landed[0]?.drag, landed[0]?.at]).toEqual([
      { x: 100, y: 80, w: 100, h: 100 },
      { x: 150, y: 130 },
    ]);
  });

  it("is the same rectangle whichever way the drag ran", () => {
    const { landed } = wire();

    pressAt(300, 260);
    releaseAt(100, 60);

    expect(landed[0]?.drag).toEqual({ x: 100, y: 80, w: 100, h: 100 });
  });

  it("needs no threshold: a click is a drag of no size", () => {
    const { landed } = wire();

    pressAt(80, 80);
    releaseAt(80, 80);

    expect(landed[0]?.drag).toEqual({ x: 40, y: 40, w: 0, h: 0 });
  });
});

describe("how far a gesture has got", () => {
  it("is shown from the press onward, a press being a drag of no size", () => {
    const { shown } = wire();

    pressAt(80, 80);
    moveTo(280, 180);
    releaseAt(280, 180);

    expect(shown).toEqual([
      { x: 40, y: 40, w: 0, h: 0 },
      { x: 90, y: 65, w: 100, h: 50 },
      { x: 90, y: 65, w: 100, h: 50 },
    ]);
  });

  it("is nothing at all, for a gesture the press said shows nothing", () => {
    const { shown, landed } = wire(() => "nothing");

    pressAt(80, 80);
    moveTo(280, 180);
    releaseAt(280, 180);

    expect(shown).toEqual([undefined, undefined, undefined]);
    // Shown nothing, and still handed on where it was let go of, which is all a
    // gesture placing a dot needs.
    expect(landed[0]?.at).toEqual({ x: 140, y: 90 });
  });

  it("is last shown where it landed, and stands there while the naming does", async () => {
    const { shown, landed } = wire();

    pressAt(80, 80);
    releaseAt(280, 180);
    moveTo(600, 600);
    expect(shown.at(-1)).toEqual({ x: 90, y: 65, w: 100, h: 50 });

    await landed[0]?.settle();

    // Taken down by the gesture that put it up, the naming it is the mark for
    // being over — and settling is all that is asked, not how it settled.
    expect(shown.at(-1)).toBeUndefined();
  });
});

describe("a naming that comes back late", () => {
  it("takes nothing down: what is showing is the gesture running now's", async () => {
    const { shown, landed } = wire();

    pressAt(80, 80);
    releaseAt(280, 180);
    pressAt(400, 400);

    await landed[0]?.settle();

    expect(shown.at(-1)).toEqual({ x: 200, y: 200, w: 0, h: 0 });
    // Let it go: a drag left in flight is still watching the window, and would
    // claim the next test's release.
    releaseAt(400, 400);
  });

  it("is told the canvas is no longer its own", () => {
    const { landed } = wire();

    pressAt(80, 80);
    releaseAt(280, 180);
    expect(landed[0]?.displaced()).toBe(false);

    pressAt(400, 400);

    expect(landed[0]?.displaced()).toBe(true);
    releaseAt(400, 400);
  });

  it("still holds it, where the press that came after began no gesture", () => {
    // The press a naming refuses: it displaces nothing, so the gesture asking is
    // still the one on the canvas and its naming still ends what it began.
    let allowed = true;
    const { landed } = wire(() => (allowed ? "rectangle" : "no-gesture"));

    pressAt(80, 80);
    releaseAt(280, 180);
    allowed = false;
    pressAt(400, 400);

    expect(landed[0]?.displaced()).toBe(false);
  });
});

describe("what never lands a rectangle", () => {
  it("a press on its own, however far it is dragged", () => {
    const { landed } = wire();

    pressAt(80, 80);
    moveTo(180, 180);

    expect(landed).toEqual([]);
    // Let it go: a drag left in flight is still watching the window, and would
    // claim the *next* test's release.
    releaseAt(180, 180);
  });

  it("a press of a non-primary button", () => {
    const { shown, landed } = wire();

    pressAt(80, 80, 2);
    releaseAt(180, 180);

    expect([shown, landed]).toEqual([[], []]);
  });

  it("a press the caller does not allow one to start from", () => {
    const { shown, landed } = wire(() => "no-gesture");

    pressAt(80, 80);
    releaseAt(180, 180);

    expect([shown, landed]).toEqual([[], []]);
  });

  it("a release of a non-primary button, which leaves the drag in flight", () => {
    const { landed } = wire();

    pressAt(80, 80);
    releaseAt(180, 180, 2);
    expect(landed).toEqual([]);

    releaseAt(180, 180);
    expect(landed).toHaveLength(1);
  });
});

describe("who a release belongs to", () => {
  let other: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    other = vi.fn();
    wire();
    element.addEventListener("pointerup", other);
  });

  it("is the gesture the press started, and nothing else listening for one", () => {
    pressAt(80, 80);
    releaseAt(180, 180);

    expect(other).not.toHaveBeenCalled();
  });

  it("is whatever else was listening, where no press of its own started one", () => {
    releaseAt(180, 180);

    expect(other).toHaveBeenCalledOnce();
  });
});

/**
 * Which of the two the window is being watched for, right now.
 *
 * The listeners themselves are what the claim is about — that a gesture at rest
 * is not on the window at all — and nothing observable tells that from a
 * listener that returns early, so they are counted on and off rather than
 * inferred from what a move does.
 */
function watchedOnWindow(): readonly string[] {
  const added = vi.mocked(window.addEventListener).mock.calls;
  const removed = vi.mocked(window.removeEventListener).mock.calls;
  return ["pointermove", "pointerup"].filter(
    (event) => timesFor(added, event) > timesFor(removed, event),
  );
}

/** How many of `calls` were about `event`. */
function timesFor(calls: readonly (readonly unknown[])[], event: string): number {
  return calls.filter(([type]) => type === event).length;
}

describe("the window", () => {
  beforeEach(() => {
    vi.spyOn(window, "addEventListener");
    vi.spyOn(window, "removeEventListener");
  });

  // Put back, so the next test counts its own gesture's listeners and not this
  // one's — and so nothing else in the suite is watched through a spy.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is watched only while a drag is in flight — a drag has to be followed off the element", () => {
    wire();
    expect(watchedOnWindow()).toEqual([]);

    pressAt(80, 80);
    expect(watchedOnWindow()).toEqual(["pointermove", "pointerup"]);

    releaseAt(180, 180);
    expect(watchedOnWindow()).toEqual([]);
  });

  it("is not watched for a press that starts no gesture", () => {
    wire(() => "no-gesture");

    pressAt(80, 80);

    expect(watchedOnWindow()).toEqual([]);
  });
});
