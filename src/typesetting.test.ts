// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The LaTeX-to-geometry engine. The bar that drives it is covered in
// label-form.test.ts.

import { describe, expect, it, vi } from "vitest";

import { prewarmTypesetting, typesetLatex } from "./typesetting";

const LATEX = "\\Sigma_{(x:A)} P(x)";

function descendantsOf(node: Element): Element[] {
  return [...node.querySelectorAll("*")];
}

describe("prewarming the typesetter", () => {
  it("leaves MathJax ready, so a label typesets off the warmed engine", async () => {
    await prewarmTypesetting();

    const { glyphs } = await typesetLatex(LATEX);
    expect(glyphs.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("boots one engine however many callers ask for it", async () => {
    await Promise.all([prewarmTypesetting(), typesetLatex(LATEX), prewarmTypesetting()]);

    // Each boot registers its own document handler with MathJax, so a second
    // one is how a duplicated engine would show itself.
    const { mathjax } = await import("@mathjax/src/js/mathjax.js");
    expect([...mathjax.handlers]).toHaveLength(1);
  });
});

describe("when the prewarm runs", () => {
  it("asks the browser for an idle slot where one is on offer", async () => {
    // jsdom has no requestIdleCallback, so without this the browser path — the
    // one that actually ships — is never exercised.
    const requestIdle = vi.fn((callback: IdleRequestCallback, _options?: IdleRequestOptions) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", requestIdle);

    try {
      await prewarmTypesetting();
      expect(requestIdle).toHaveBeenCalledOnce();
      expect(requestIdle.mock.calls[0]?.[1]).toMatchObject({ timeout: expect.any(Number) });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("holds off until the page is idle rather than loading during the first paint", async () => {
    // Warm it for real first, so the mocked-clock run below is only waiting on
    // the idle callback and not on modules that have yet to be fetched.
    await prewarmTypesetting();

    vi.useFakeTimers();
    try {
      let settled = false;
      void prewarmTypesetting().then(() => {
        settled = true;
      });

      // Drain the microtask queue without letting any timer fire. Everything
      // MathJax needs is loaded, so the only thing that can still be holding
      // this back is the wait for an idle moment.
      for (let tick = 0; tick < 50; tick += 1) {
        await Promise.resolve();
      }
      expect(settled).toBe(false);

      await vi.runAllTimersAsync();
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("typesetting LaTeX", () => {
  it("returns an SVG <g> whose glyphs are <path> geometry", async () => {
    const { glyphs } = await typesetLatex(LATEX);

    expect(glyphs.tagName).toBe("g");
    expect(glyphs.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(glyphs.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("leaks no HTML or MathML into the canvas — every node is SVG", async () => {
    const { glyphs } = await typesetLatex(LATEX);

    const foreign = descendantsOf(glyphs).filter(
      (node) => node.namespaceURI !== "http://www.w3.org/2000/svg",
    );
    expect(foreign).toEqual([]);
    expect(glyphs.querySelector("foreignObject")).toBeNull();
    expect(glyphs.closest("mjx-container")).toBeNull();
  });

  it("draws every mark as geometry — no <text> falling back on a system font", async () => {
    const { glyphs } = await typesetLatex(LATEX);

    // MathJax emits <text> only when it has no outline for a glyph, which would
    // leave the export depending on whatever font the viewer happens to have.
    expect(glyphs.querySelector("text")).toBeNull();
    const marks = descendantsOf(glyphs).filter((node) => node.children.length === 0);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.map((node) => node.tagName)).toEqual(marks.map(() => "path"));
  });

  it("inlines every glyph, with no <defs>/<use> font cache to leave behind", async () => {
    const { glyphs } = await typesetLatex(LATEX);

    expect(glyphs.querySelector("defs")).toBeNull();
    expect(glyphs.querySelector("use")).toBeNull();
  });

  it("hands back geometry alone, cut free of MathJax's own packaging", async () => {
    const { glyphs } = await typesetLatex(LATEX);

    expect(glyphs.parentElement).toBeNull();
  });
});

describe("measuring a typeset run", () => {
  it("says how much room it takes, which the geometry alone no longer does", async () => {
    const run = await typesetLatex(LATEX);

    // `\Sigma_{(x:A)} P(x)` is wider than it is tall and descends below the
    // baseline, its subscript being the only thing down there.
    expect(run.width).toBeGreaterThan(run.ascent + run.depth);
    expect(run.ascent).toBeGreaterThan(0);
    expect(run.depth).toBeGreaterThan(0);
    expect(run.depth).toBeLessThan(run.ascent);
  });

  it("measures a run that sits wholly on the baseline as having no depth", async () => {
    const run = await typesetLatex("A");

    expect(run.depth).toBe(0);
    expect(run.ascent).toBeGreaterThan(0);
  });
});

describe("LaTeX it cannot draw", () => {
  it("refuses invalid LaTeX rather than typesetting an error box", async () => {
    await expect(typesetLatex("\\notacontrolsequence{x}")).rejects.toThrow(
      /undefined control sequence/iu,
    );
  });

  it("refuses a character the font has no outline for, rather than passing off system text", async () => {
    // New Computer Modern has no CJK at all — no range will ever supply it.
    // MathJax would draw it as <text> in a serif face: right on screen, broken
    // in an exported file.
    await expect(typesetLatex("\\text{\u6F22}")).rejects.toThrow(/no glyph outline for "\u6F22"/iu);
  });
});

describe("glyph ranges the font keeps out of its main entry", () => {
  // Each of these needs a range fetched on demand: the double-struck, fraktur,
  // sans-serif and monospace alphabets, and accented or non-Latin letters.
  const NEEDS_A_RANGE = [
    "\\mathbb{R}",
    "\\mathbb{N}",
    "\\mathfrak{g}",
    "\\mathsf{ab}",
    "\\mathtt{ab}",
    "\\text{caf\u00E9}",
    "\\text{\u05D0}",
  ];

  it("draws them as outlines rather than falling back to system text", async () => {
    for (const latex of NEEDS_A_RANGE) {
      const { glyphs } = await typesetLatex(latex);

      expect(glyphs.querySelector("text"), latex).toBeNull();
      expect(glyphs.querySelectorAll("path").length, latex).toBeGreaterThan(0);
    }
  });

  it("fetches them through the bundler instead of MathJax's runtime URL builder", async () => {
    await prewarmTypesetting();
    const { mathjax } = await import("@mathjax/src/js/mathjax.js");

    // MathJax asks under the package's `js/` alias; the files ship from `mjs/`.
    await expect(
      mathjax.asyncLoad("@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js"),
    ).resolves.toBeDefined();
    await expect(
      mathjax.asyncLoad("@mathjax/mathjax-newcm-font/js/svg/dynamic/nosuchrange.js"),
    ).rejects.toThrow(/no bundled glyph range/iu);
  });
});

describe("a boot that fails", () => {
  it("is not remembered — the next label tries again", async () => {
    const MODULE = "@mathjax/src/js/adaptors/browserAdaptor.js";
    type Adaptors = typeof import("@mathjax/src/js/adaptors/browserAdaptor.js");
    let bootFails = true;

    // Stand in for a boot that dies part-way — a chunk that never arrives, or
    // an engine that will not construct.
    vi.doMock(MODULE, async () => {
      const actual = await vi.importActual<Adaptors>(MODULE);
      return {
        browserAdaptor: () => {
          if (bootFails) {
            throw new Error("engine failed to start");
          }
          return actual.browserAdaptor();
        },
      };
    });
    // A fresh module graph, so this exercises its own pipeline memo rather than
    // the one the tests above have already warmed.
    vi.resetModules();
    const isolated = await import("./typesetting");

    await expect(isolated.typesetLatex(LATEX)).rejects.toThrow("engine failed to start");

    bootFails = false;
    const { glyphs } = await isolated.typesetLatex(LATEX);
    expect(glyphs.querySelectorAll("path").length).toBeGreaterThan(0);

    vi.doUnmock(MODULE);
    vi.resetModules();
  });
});
