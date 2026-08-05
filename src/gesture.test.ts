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

/** What a wired gesture hands on: what it showed, and what it landed. */
interface Wired {
  readonly shown: (Extent | undefined)[];
  readonly landed: { drag: Extent; at: Point }[];
}

function wire(starts: (at: Point) => Started = () => "rectangle"): Wired {
  const shown: (Extent | undefined)[] = [];
  const landed: { drag: Extent; at: Point }[] = [];
  enableGesture(
    element,
    at,
    (drag) => shown.push(drag),
    starts,
    (drag, where) => landed.push({ drag, at: where }),
  );
  return { shown, landed };
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

    expect(landed).toEqual([{ drag: { x: 100, y: 80, w: 100, h: 100 }, at: { x: 150, y: 130 } }]);
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

  it("is last shown where it landed, and left there for whoever takes it down", () => {
    const { shown } = wire();

    pressAt(80, 80);
    releaseAt(280, 180);
    moveTo(600, 600);

    expect(shown.at(-1)).toEqual({ x: 90, y: 65, w: 100, h: 50 });
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
