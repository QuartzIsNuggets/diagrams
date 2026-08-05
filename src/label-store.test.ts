// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// What a source has been set to, and the bookkeeping the three doors keep over
// it. The engine is replaced wholesale — there is no canvas here, no diagram and
// no MathJax boot — because what is claimed is *when* the engine is asked, and
// that is only ever an inference through a rendered document. What the real
// engine makes of real LaTeX is `typesetting.test.ts`'s.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLabelStore } from "./label-store";
import type { GlyphRun } from "./typesetting";
import { typesetLatex } from "./typesetting";

vi.mock("./typesetting", () => ({ typesetLatex: vi.fn() }));

/** What the fake engine says of a source it will not set. */
const REFUSAL = "undefined control sequence";

/**
 * A run standing for whatever was asked for.
 *
 * The store passes a run through untouched, so the glyphs need only be an
 * element and the metrics need only differ per source — which is the claim they
 * are here for: the run that comes back out is the one that source was set to.
 */
function runFor(latex: string): GlyphRun {
  return { glyphs: document.createElement("g"), width: latex.length, ascent: 1, depth: 0 };
}

/** How many times the engine has been asked for `source`. */
function timesAsked(source: string): number {
  return vi.mocked(typesetLatex).mock.calls.filter(([latex]) => latex === source).length;
}

/** Make the engine refuse `source`, and set everything else. */
function refuses(source: string): void {
  vi.mocked(typesetLatex).mockImplementation((latex) =>
    latex === source ? Promise.reject(new Error(REFUSAL)) : Promise.resolve(runFor(latex)),
  );
}

beforeEach(() => {
  vi.mocked(typesetLatex).mockReset();
  vi.mocked(typesetLatex).mockImplementation((latex) => Promise.resolve(runFor(latex)));
});

describe("asking for a source", () => {
  it("sets it, and hands back the run it set to", async () => {
    const run = await createLabelStore().set("x");

    expect(run.width).toBe(1);
    expect(timesAsked("x")).toBe(1);
  });

  it("takes what is remembered rather than setting it again", async () => {
    const labels = createLabelStore();

    const first = await labels.set("\\alpha");
    const second = await labels.set("\\alpha");

    expect(second).toBe(first);
    expect(timesAsked("\\alpha")).toBe(1);
  });

  it("throws what the typesetter said of one it will not set", async () => {
    refuses("bad");

    await expect(createLabelStore().set("bad")).rejects.toThrow(REFUSAL);
  });

  it("retries a source that refused, a bad moment never being held against it", async () => {
    const labels = createLabelStore();
    refuses("bad");
    await expect(labels.set("bad")).rejects.toThrow();

    // The engine having come right — a boot that did not arrive, a range that
    // now loads. Someone re-submitting is asking for exactly this.
    vi.mocked(typesetLatex).mockImplementation((latex) => Promise.resolve(runFor(latex)));
    await expect(labels.set("bad")).resolves.toHaveProperty("width", 3);

    expect(timesAsked("bad")).toBe(2);
  });
});

describe("filling in a set of sources", () => {
  it("sets what has never been set, and names nothing", async () => {
    const labels = createLabelStore();

    expect(await labels.setAll(["p", "q"])).toEqual([]);

    expect([timesAsked("p"), timesAsked("q")]).toEqual([1, 1]);
  });

  it("sets a source two marks share once", async () => {
    await createLabelStore().setAll(["p", "p", "p"]);

    expect(timesAsked("p")).toBe(1);
  });

  it("leaves alone what is already set", async () => {
    const labels = createLabelStore();
    await labels.set("p");

    await labels.setAll(["p"]);

    expect(timesAsked("p")).toBe(1);
  });

  it("names each source that would not set, and what the typesetter said", async () => {
    refuses("bad");

    const unset = await createLabelStore().setAll(["p", "bad"]);

    expect(unset).toEqual([{ source: "bad", why: REFUSAL }]);
  });

  it("replays a refusal rather than asking again, a fill being nobody asking", async () => {
    const labels = createLabelStore();
    refuses("bad");

    const first = await labels.setAll(["bad"]);
    const again = await labels.setAll(["bad"]);

    expect(again).toEqual(first);
    expect(timesAsked("bad")).toBe(1);
  });
});

describe("what a drawing may draw", () => {
  it("is the run, once the source has been set", async () => {
    const labels = createLabelStore();
    const run = await labels.set("x");

    expect(labels.runOf("x")).toBe(run);
  });

  it("is nothing at all for a source never set, and asks for none", () => {
    expect(createLabelStore().runOf("x")).toBeUndefined();

    expect(timesAsked("x")).toBe(0);
  });

  it("is nothing for one that refused, and asks again no more than it asked at all", async () => {
    const labels = createLabelStore();
    refuses("bad");
    await labels.setAll(["bad"]);

    expect(labels.runOf("bad")).toBeUndefined();

    // A redraw asks nothing: every frame retrying every source that will not
    // set is exactly what remembering a refusal as a refusal is for.
    expect(timesAsked("bad")).toBe(1);
  });
});

describe("a store", () => {
  it("remembers only what it was itself asked", async () => {
    const labels = createLabelStore();
    await labels.set("x");

    expect(createLabelStore().runOf("x")).toBeUndefined();
  });
});
