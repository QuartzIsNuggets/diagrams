// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// Emitting a diagram as a file. Nothing here draws on a canvas or lays anything
// out: an export is a drawing of the model, so a diagram and a real MathJax
// pipeline are all it takes to make one — which is itself half of what is being
// claimed. The other half is that what the model holds survives the trip.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SVG_NS } from "./canvas";
import type { Diagram, Point } from "./diagram";
import { addBox, addDot, EMPTY_DIAGRAM, labelDot } from "./diagram";
import { createExportControls, serializeDiagram } from "./export-svg";
import type { OutgoingFile } from "./writer";
import { writeFile } from "./writer";

// The one collaborator stood in for, against the real everything else above:
// what Export promises ends at the writer's door — the serialized diagram, under
// a name and a type — and where the bytes go from there is `writer.test.ts`'s.
vi.mock("./writer", () => ({
  writeFile: vi.fn(() => Promise.resolve({ outcome: "handed-off" })),
}));

const LATEX = "\\Sigma_{(x:A)} P(x)";

/** What the filesystem says when it will not take the file. */
const REFUSAL = "Permission denied (os error 13)";

/** The box every diagram below is built on: a wide one, well off the origin. */
const BOX = { source: "A", x: 200, y: -120, w: 400, h: 300 };

/** The diagram the affordance will be asked for — the editor's `current`. */
let current: Diagram;
let controls: HTMLDivElement;
let button: HTMLButtonElement;

/**
 * The naming bar, stood in for by the one thing the affordance is told of it.
 *
 * A boolean is the whole of what crosses this seam, so raising and taking away a
 * bar is calling this — which is also the claim: nothing here reads a form on the
 * page, and how a naming actually opens and closes is `naming-bar.test.ts`'s.
 */
let nowAsking: (asking: boolean) => void;

/** A box holding a dot at each of `places`, none of them named. */
function boxOfDots(...places: readonly Point[]): Diagram {
  return places.reduce<Diagram>(
    (sofar, at) => {
      const next = addDot(sofar, at);
      if (typeof next !== "string") {
        return next.diagram;
      }
      throw new Error(`the diagram refused a dot at (${String(at.x)}, ${String(at.y)}): ${next}`);
    },
    addBox(EMPTY_DIAGRAM, BOX),
  );
}

/**
 * A box holding a named dot, whose source nothing has settled.
 *
 * Handed over exactly as the model holds it: what typesets the label is the
 * export itself, through the real pipeline, so every claim below about a name in
 * the file is also the claim that nothing had to be done to the diagram first.
 */
function withLabel(latex: string, ...places: readonly Point[]): Diagram {
  const placed = boxOfDots({ x: 120, y: -45 }, ...places);
  const dot = placed.dots[0]?.id;
  if (!dot) {
    throw new Error("the diagram was built with no dot to name");
  }
  return labelDot(placed, dot, latex);
}

/** Press Export and read back the file the writer was handed. */
async function exportOnce(): Promise<OutgoingFile> {
  const before = vi.mocked(writeFile).mock.calls.length;

  button.click();

  // Waited for rather than read straight back: an export sets the diagram's
  // labels before it has any bytes, which is a real typesetting run the first
  // time a source is seen.
  await vi.waitFor(() => {
    expect(vi.mocked(writeFile).mock.calls.length).toBeGreaterThan(before);
  });
  const file = vi.mocked(writeFile).mock.lastCall?.[0];
  if (!file) {
    throw new Error("pressing Export handed the writer no file");
  }
  return file;
}

/** Let a press run all the way to the writer's door, or prove it never sets off. */
async function pressExport(): Promise<void> {
  button.click();
  await new Promise((resume) => {
    setTimeout(resume, 0);
  });
}

/** What the affordance is telling the user, if anything. */
function reported(): string {
  return controls.querySelector(".export-error")?.textContent ?? "";
}

/** Press Export, have the write refused, and wait for the affordance to say so. */
async function refuseOnce(): Promise<void> {
  vi.mocked(writeFile).mockRejectedValueOnce(new Error(REFUSAL));

  button.click();

  await vi.waitFor(() => expect(reported()).not.toBe(""));
}

/** The exported document, reparsed from its own bytes the way a viewer would. */
async function reopen(diagram: Diagram): Promise<SVGSVGElement> {
  const parsed = new DOMParser().parseFromString(await serializeDiagram(diagram), "image/svg+xml");
  expect(parsed.querySelector("parsererror")).toBeNull();
  return parsed.documentElement as unknown as SVGSVGElement;
}

/** The frame a document's `viewBox` states, named rather than positional. */
function viewBoxOf(file: SVGSVGElement): { x: number; y: number; width: number; height: number } {
  const [x = 0, y = 0, width = 0, height = 0] = (file.getAttribute("viewBox") ?? "")
    .split(" ")
    .map(Number);
  return { x, y, width, height };
}

function pathDataOf(root: ParentNode): (string | null)[] {
  return [...root.querySelectorAll("path")].map((path) => path.getAttribute("d"));
}

beforeEach(() => {
  current = EMPTY_DIAGRAM;
  controls = createExportControls(
    () => current,
    (watch) => {
      nowAsking = watch;
      // Told at once, the way the bar tells it: the page opens with nothing being
      // named, and the control has to learn that rather than assume it.
      watch(false);
    },
  );
  button = controls.querySelector("button")!;
  document.body.replaceChildren(controls);

  vi.mocked(writeFile).mockClear();
});

describe("the export affordance", () => {
  it("is a button that says what it does", () => {
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBeTruthy();
  });

  it("does not submit whatever form it may end up inside", () => {
    expect(button.type).toBe("button");
  });

  it("carries the classes that put it on screen, so it is there to be pressed", () => {
    // jsdom applies no stylesheet, so the classes are as far as this can go:
    // where they actually land is `style.css`'s to answer.
    expect(controls.classList.contains("export-controls")).toBe(true);
    expect(button.classList.contains("export-button")).toBe(true);
  });

  it("holds the place a refusal will go before there is one to report", () => {
    const region = controls.querySelector(".export-error");

    expect(region?.getAttribute("role")).toBe("alert");
    expect(region?.textContent).toBe("");
  });

  it("keeps that place above the button, which must not move under the cursor", () => {
    // jsdom lays nothing out, so the order is as far as this can go: the
    // affordance is anchored to the bottom of the viewport, so a message before
    // the button grows the column upward and leaves the button where it was.
    expect(controls.firstElementChild?.classList.contains("export-error")).toBe(true);
    expect(controls.lastElementChild).toBe(button);
  });
});

describe("pressing Export", () => {
  it("hands the writer a file to put somewhere, named as an SVG", async () => {
    expect((await exportOnce()).filename).toMatch(/\.svg$/u);
  });

  it("calls it SVG, so the file opens as a drawing and not as text", async () => {
    expect((await exportOnce()).mediaType).toMatch(/^image\/svg\+xml\b/u);
  });

  it("emits the diagram as it stands when the button is pressed, not the one it was built with", async () => {
    current = boxOfDots({ x: 120, y: -45 });

    expect((await exportOnce()).contents).toBe(await serializeDiagram(current));
    expect((await exportOnce()).contents).toContain("<circle");
  });
});

// No diagram leaves the editor half-made: a naming that is still open is a
// term-dot placed but not named, or a box not made at all until its source sets,
// so the file would be quietly not the drawing on screen.
describe("Export while a naming is open", () => {
  it("is live to begin with, nothing being named on a page that just opened", () => {
    expect(button.disabled).toBe(false);
  });

  it("goes inert, and says so before a press is made rather than swallowing one", async () => {
    nowAsking(true);

    // `disabled` is both halves at once — it stops the press and the keystroke,
    // and it is what the stylesheet dims. jsdom applies none, so where that lands
    // is `style.css`'s to answer.
    expect(button.disabled).toBe(true);
    await pressExport();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("is live again as soon as the bar closes, and exports the diagram it left", async () => {
    nowAsking(true);
    current = boxOfDots({ x: 120, y: -45 });

    nowAsking(false);

    expect(button.disabled).toBe(false);
    // However that naming closed — a source that set, a give-up, a press that
    // cancelled it — is the bar's own business and reaches here as this one
    // `false`; `naming-bar.test.ts` is where each road is walked.
    expect((await exportOnce()).contents).toBe(await serializeDiagram(current));
  });

  it("leaves the refusal region alone: it stops an export, and reports none", async () => {
    await refuseOnce();

    nowAsking(true);

    // A write the filesystem refused is still the last attempt. Going inert is
    // not an attempt at all, so it has nothing to say here and says nothing.
    expect(reported()).toBe(`The export could not be written: ${REFUSAL}`);
  });
});

// A refused write is the one thing the app surface can have and the web surface
// cannot, and the app window has no console to report it to instead.
describe("a write the filesystem refuses", () => {
  it("is reported on screen, naming what failed and what the filesystem said", async () => {
    await refuseOnce();

    // Asserted whole, wording and all, because reading it is the point: what
    // the filesystem said, under what it refused to do, and no `Error:` from a
    // stringified throwable in front of either.
    expect(reported()).toBe(`The export could not be written: ${REFUSAL}`);
  });

  it("is reported when it arrives as a bare string, which is how the app's plugins reject", async () => {
    const refusal = "forbidden path: /etc/diagram.svg";
    vi.mocked(writeFile).mockRejectedValueOnce(refusal);

    button.click();

    await vi.waitFor(() => expect(reported()).toContain(refusal));
  });
});

// The message describes the last attempt, so anything the last attempt was
// other than a failure empties it — the rule `.canvas-error` follows.
describe("a refusal already on screen", () => {
  it.each([
    ["a completed write", { outcome: "written", path: "/home/somebody/diagram.svg" }],
    ["a hand-off", { outcome: "handed-off" }],
    ["a cancelled dialog", { outcome: "cancelled" }],
  ] as const)("is cleared by %s, which did not fail", async (_outcome, result) => {
    await refuseOnce();
    vi.mocked(writeFile).mockResolvedValueOnce(result);

    button.click();

    await vi.waitFor(() => expect(reported()).toBe(""));
  });
});

describe("the serialized document", () => {
  it("reopens on its own as an SVG document", async () => {
    expect((await reopen(boxOfDots())).namespaceURI).toBe(SVG_NS);
  });

  it("opens with an XML declaration, so its encoding is never guessed at", async () => {
    expect(await serializeDiagram(boxOfDots())).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?>/u,
    );
  });

  it("declares the SVG namespace, so nothing has to be told what it is", async () => {
    expect(await serializeDiagram(boxOfDots())).toContain(`xmlns="${SVG_NS}"`);
  });

  it("is made with no page to lay it out — no canvas, and nothing in the document", async () => {
    // Nothing above has drawn on a canvas or attached anything anywhere: the
    // body holds the affordance and no drawing at all. That this passes under
    // jsdom, which lays nothing out, is the claim — a batch caller has no more
    // of a page than this.
    expect(document.querySelector("svg")).toBeNull();

    expect(await serializeDiagram(boxOfDots({ x: 120, y: -45 }))).toContain("<circle");
  });
});

describe("the frame the file is drawn in", () => {
  it("comes from the diagram's own extent, with room around it", async () => {
    const { x, y, width, height } = viewBoxOf(await reopen(boxOfDots()));

    // The box is 400×300 about (200, −120), y up. The frame holds it with the
    // same margin on every side, so it is bigger by twice that on each axis and
    // still centred on the box.
    const margin = (width - BOX.w) / 2;
    expect(margin).toBeGreaterThan(0);
    expect(height - BOX.h).toBeCloseTo(2 * margin);
    expect(x + width / 2).toBeCloseTo(BOX.x);
    // The document's y runs down where the diagram's runs up, so the frame's
    // centre in the file is the box's centre negated.
    expect(y + height / 2).toBeCloseTo(-BOX.y);
  });

  it("states a width and a height that agree with it, so nothing scales", async () => {
    const file = await reopen(boxOfDots());
    const { width, height } = viewBoxOf(file);

    expect(file.getAttribute("width")).toBe(String(width));
    expect(file.getAttribute("height")).toBe(String(height));
  });

  it("is the same file whatever the window is, there being no window in it", async () => {
    // The old export took its frame from a rendered canvas, so this is the
    // regression the whole change is about: two exports of one diagram, and
    // nothing between them that a resize could have changed.
    const diagram = boxOfDots({ x: 120, y: -45 });

    expect(await serializeDiagram(diagram)).toBe(await serializeDiagram(diagram));
  });

  it("moves with the diagram rather than framing a fixed corner", async () => {
    const near = addBox(EMPTY_DIAGRAM, { source: "A", x: 60, y: -60, w: 40, h: 40 });
    const far = addBox(EMPTY_DIAGRAM, { source: "A", x: 900, y: -700, w: 40, h: 40 });

    const nearFrame = viewBoxOf(await reopen(near));
    const farFrame = viewBoxOf(await reopen(far));

    // The same box, so the same size of file — sitting somewhere else in the
    // plane, which only the origin has moved for.
    expect([farFrame.width, farFrame.height]).toEqual([nearFrame.width, nearFrame.height]);
    expect(farFrame.x - nearFrame.x).toBeCloseTo(840);
    expect(farFrame.y - nearFrame.y).toBeCloseTo(640);
  });
});

// The frame is what the backend drew rather than what the model holds, which
// these two are what it costs and what it buys.
describe("what the frame has to hold", () => {
  it("a label reaching outside the box it names, which is not cropped off", async () => {
    // A dot's label stands off the dot, so a dot near a wall puts glyphs past
    // it — room only the backend that set the run knows to leave.
    const diagram = withLabel(LATEX);
    const { x, width } = viewBoxOf(await reopen(diagram));

    const glyphs = [...(await reopen(diagram)).querySelectorAll("path")];
    expect(glyphs.length).toBeGreaterThan(0);
    expect(x).toBeLessThan(BOX.x - BOX.w / 2);
    expect(x + width).toBeGreaterThan(BOX.x + BOX.w / 2);
  });

  it("everything an exact frame did, each edge having been rounded outward", async () => {
    // Glyph metrics are fractional, so the union of them is too, and it
    // serializes as float noise. Rounding is what spares a reader that; going
    // *outward* is what keeps it from costing a mark.
    const { x, y, width, height } = viewBoxOf(await reopen(withLabel(LATEX)));

    expect([x, y, width, height].filter((one) => !Number.isInteger(one))).toEqual([]);
  });

  it("a diagram with nothing in it, framed as a blank square rather than no size", async () => {
    const { width, height } = viewBoxOf(await reopen(EMPTY_DIAGRAM));

    expect(width).toBeGreaterThan(0);
    expect(height).toBe(width);
  });
});

describe("what the exported file draws", () => {
  it("carries every dot in the diagram, with the geometry and ink it is drawn in", async () => {
    const file = await reopen(boxOfDots({ x: 120, y: -45 }, { x: 300, y: -200 }));

    const dots = [...file.querySelectorAll("circle")];
    expect(dots).toHaveLength(2);
    // The diagram's own coordinates, y up, under the one flip at the drawing's
    // root — which travels with the file, the frame being stated the other way.
    expect(dots.map((dot) => [dot.getAttribute("cx"), dot.getAttribute("cy")])).toEqual([
      ["120", "-45"],
      ["300", "-200"],
    ]);
    expect(Number(dots[0]?.getAttribute("r"))).toBeGreaterThan(0);
    expect(dots[0]?.getAttribute("fill")).toBeTruthy();
  });

  it("carries the box itself — walls and type expression, not only what is inside it", async () => {
    const file = await reopen(withLabel("A"));

    expect(file.querySelectorAll("g.box > rect")).toHaveLength(1);
    expect(file.querySelector("g.box-label")).not.toBeNull();
  });

  it("carries a typeset label as glyph paths, placed and coloured", async () => {
    const file = await reopen(withLabel(LATEX));

    const label = file.querySelector("g.dot-label");
    expect(pathDataOf(label!).length).toBeGreaterThan(0);
    expect(label?.getAttribute("transform")).toMatch(/^translate\(/u);
    expect(label?.getAttribute("color")).toBeTruthy();
  });

  it("names a source nothing settled first, the document setting its own labels", async () => {
    // A source no test above has named, so nothing is remembered of it: what
    // typesets it is the export, and a file that came out named is the whole
    // claim — no caller owes a diagram a settling before it may be emitted.
    const file = await reopen(withLabel("\\aleph_{0}"));

    expect(pathDataOf(file.querySelector("g.dot-label")!).length).toBeGreaterThan(0);
  });

  it("draws dots and label together — the whole diagram, not one kind of mark", async () => {
    const file = await reopen(withLabel(LATEX, { x: 300, y: -200 }));

    expect(file.querySelectorAll("circle")).toHaveLength(2);
    expect(file.querySelectorAll("g.dot-label")).toHaveLength(1);
  });

  it("carries no pointer rule, which is the screen's business and not the file's", async () => {
    expect((await reopen(boxOfDots())).querySelector("[pointer-events]")).toBeNull();
  });
});

// A source the backend will not set costs its own label and no more. The export
// says nothing of it either: unlabelled is what the screen shows too, and where
// such a source is named is the settling the editor does.
describe("a source the backend will not set", () => {
  it("comes out as a mark with no name, the rest of the drawing standing", async () => {
    const file = await reopen(withLabel("\\notacontrolsequence{e}"));

    expect(file.querySelectorAll("circle")).toHaveLength(1);
    expect(file.querySelector("g.box-label")).not.toBeNull();
    expect(file.querySelector("g.dot-label")).toBeNull();
  });

  it("is still a file that leaves, and nothing the affordance has to report", async () => {
    current = withLabel("\\notacontrolsequence{f}");

    expect((await exportOnce()).contents).toContain("<circle");
    expect(reported()).toBe("");
  });
});

describe("what the exported file needs from outside", () => {
  it("resolves every glyph inside the file — no <use> into a font cache left behind", async () => {
    const file = await reopen(withLabel(LATEX));

    expect(file.querySelectorAll("use")).toHaveLength(0);
    expect(file.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(pathDataOf(file).filter((d) => !d)).toEqual([]);
  });

  it("holds no element that reaches for something else", async () => {
    const file = await reopen(withLabel(LATEX));

    expect(file.querySelectorAll("use, image, foreignObject, script, style")).toHaveLength(0);
    const references = [...file.querySelectorAll("*")]
      .flatMap((element) => [...element.attributes])
      .filter(({ name, value }) => name.endsWith("href") || value.includes("url("))
      .map(({ name, value }) => `${name}=${value}`);
    expect(references).toEqual([]);
  });

  it("names no location but the SVG namespace itself", async () => {
    const locations = new Set(
      (await serializeDiagram(withLabel(LATEX))).match(/https?:\/\/[^"'\s>]+/gu),
    );

    expect([...locations]).toEqual([SVG_NS]);
  });

  it("carries no text needing a font the reader may not have", async () => {
    expect((await reopen(withLabel(LATEX))).querySelectorAll("text")).toHaveLength(0);
  });
});
