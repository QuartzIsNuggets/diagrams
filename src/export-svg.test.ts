// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// Serializing the canvas to a standalone file. The tests below export real
// content — dots plopped through `enablePlopping`, a label typeset through the
// real MathJax pipeline — because an export is only worth anything if what is
// on screen survives the trip.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas, enablePlopping, SVG_NS } from "./canvas";
import { createExportControls, serializeCanvas } from "./export-svg";
import { createLabelForm } from "./label-form";
import type { OutgoingFile } from "./writer";
import { writeFile } from "./writer";

// The one collaborator stood in for, against the real everything else above:
// what Export promises ends at the writer's door — the serialized canvas, under
// a name and a type — and where the bytes go from there is `writer.test.ts`'s.
vi.mock("./writer", () => ({
  writeFile: vi.fn(() => Promise.resolve({ outcome: "handed-off" })),
}));

const LATEX = "\\Sigma_{(x:A)} P(x)";

/** What the filesystem says when it will not take the file. */
const REFUSAL = "Permission denied (os error 13)";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

let canvas: SVGSVGElement;
let controls: HTMLDivElement;
let button: HTMLButtonElement;

/**
 * Give the canvas a rendered size.
 *
 * jsdom has no layout, so every box is 0×0 and the exported `viewBox` would be
 * asserted against nothing.
 */
function sizeCanvas(width: number, height: number): void {
  canvas.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, width, height);
}

/** Plop a dot at a canvas point, the way a pointer release does. */
function plopDotAt(x: number, y: number): void {
  canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, button: 0 }));
}

/** Typeset a label onto the canvas through the real form and pipeline. */
async function placeLabel(latex: string): Promise<void> {
  const form = createLabelForm(canvas);
  document.body.append(form);
  const before = canvas.querySelectorAll("g.math-label").length;

  form.querySelector("input")!.value = latex;
  form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();

  await vi.waitFor(() => {
    expect(form.querySelector(".label-error")?.textContent).toBe("");
    expect(canvas.querySelectorAll("g.math-label")).toHaveLength(before + 1);
  });
}

/** Press Export and read back the file the writer was handed. */
function exportOnce(): OutgoingFile {
  button.click();
  const file = vi.mocked(writeFile).mock.lastCall?.[0];
  if (!file) {
    throw new Error("pressing Export handed the writer no file");
  }
  return file;
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
function reopenExport(): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(serializeCanvas(canvas), "image/svg+xml");
  expect(parsed.querySelector("parsererror")).toBeNull();
  return parsed.documentElement as unknown as SVGSVGElement;
}

function pathDataOf(root: ParentNode): (string | null)[] {
  return [...root.querySelectorAll("path")].map((path) => path.getAttribute("d"));
}

beforeEach(() => {
  canvas = createCanvas();
  enablePlopping(canvas);
  controls = createExportControls(canvas);
  button = controls.querySelector("button")!;
  document.body.replaceChildren(canvas, controls);
  sizeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);

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
  it("hands the writer a file to put somewhere, named as an SVG", () => {
    expect(exportOnce().filename).toMatch(/\.svg$/u);
  });

  it("calls it SVG, so the file opens as a drawing and not as text", () => {
    expect(exportOnce().mediaType).toMatch(/^image\/svg\+xml\b/u);
  });

  it("hands over the serialized canvas itself", () => {
    plopDotAt(120, 45);

    expect(exportOnce().contents).toBe(serializeCanvas(canvas));
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
// other than a failure empties it — the rule `.label-error` follows.
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
  it("reopens on its own as an SVG document", () => {
    expect(reopenExport().namespaceURI).toBe(SVG_NS);
  });

  it("opens with an XML declaration, so its encoding is never guessed at", () => {
    expect(serializeCanvas(canvas)).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
  });

  it("declares the SVG namespace, so nothing has to be told what it is", () => {
    expect(serializeCanvas(canvas)).toContain(`xmlns="${SVG_NS}"`);
  });

  it("carries its own width, height and viewBox — the live canvas has none", () => {
    expect(canvas.getAttribute("viewBox")).toBeNull();

    const exported = reopenExport();
    expect(exported.getAttribute("width")).toBe(String(CANVAS_WIDTH));
    expect(exported.getAttribute("height")).toBe(String(CANVAS_HEIGHT));
    expect(exported.getAttribute("viewBox")).toBe(
      `0 0 ${String(CANVAS_WIDTH)} ${String(CANVAS_HEIGHT)}`,
    );
  });

  it("frames the diagram exactly as the screen does, so nothing shifts or crops", () => {
    sizeCanvas(1024, 300);

    const exported = reopenExport();
    expect(exported.getAttribute("width")).toBe("1024");
    expect(exported.getAttribute("viewBox")).toBe("0 0 1024 300");
  });

  it("leaves the live canvas as it was", () => {
    serializeCanvas(canvas);

    expect(canvas.getAttribute("viewBox")).toBeNull();
    expect(canvas.getAttribute("width")).toBeNull();
  });
});

describe("what the exported file draws", () => {
  it("carries every dot on screen, with the geometry and ink it was drawn in", () => {
    plopDotAt(120, 45);
    plopDotAt(300, 200);

    const dots = [...reopenExport().querySelectorAll("circle")];
    expect(dots).toHaveLength(2);
    expect(dots.map((dot) => [dot.getAttribute("cx"), dot.getAttribute("cy")])).toEqual([
      ["120", "45"],
      ["300", "200"],
    ]);
    expect(Number(dots[0]?.getAttribute("r"))).toBeGreaterThan(0);
    expect(dots[0]?.getAttribute("fill")).toBeTruthy();
  });

  it("carries the typeset label as the same glyph paths that are on screen", async () => {
    await placeLabel(LATEX);

    const onScreen = pathDataOf(canvas);
    expect(onScreen.length).toBeGreaterThan(0);
    expect(pathDataOf(reopenExport())).toEqual(onScreen);
  });

  it("keeps the label's placement and colour, which page CSS would not travel with", async () => {
    await placeLabel(LATEX);

    const label = reopenExport().querySelector("g.math-label");
    expect(label?.getAttribute("transform")).toBe(
      canvas.querySelector("g.math-label")?.getAttribute("transform"),
    );
    expect(label?.getAttribute("color")).toBeTruthy();
  });

  it("draws dots and label together — the whole canvas, not one kind of mark", async () => {
    plopDotAt(400, 400);
    await placeLabel(LATEX);

    const exported = reopenExport();
    expect(exported.querySelectorAll("circle")).toHaveLength(1);
    expect(exported.querySelectorAll("g.math-label")).toHaveLength(1);
  });
});

describe("what the exported file needs from outside", () => {
  it("resolves every glyph inside the file — no <use> into a font cache left behind", async () => {
    await placeLabel(LATEX);

    const exported = reopenExport();
    expect(exported.querySelectorAll("use")).toHaveLength(0);
    expect(exported.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(pathDataOf(exported).filter((d) => !d)).toEqual([]);
  });

  it("holds no element that reaches for something else", async () => {
    plopDotAt(120, 45);
    await placeLabel(LATEX);

    const exported = reopenExport();
    expect(exported.querySelectorAll("use, image, foreignObject, script, style")).toHaveLength(0);
    const references = [...exported.querySelectorAll("*")]
      .flatMap((element) => [...element.attributes])
      .filter(({ name, value }) => name.endsWith("href") || value.includes("url("))
      .map(({ name, value }) => `${name}=${value}`);
    expect(references).toEqual([]);
  });

  it("names no location but the SVG namespace itself", async () => {
    await placeLabel(LATEX);

    const locations = new Set(serializeCanvas(canvas).match(/https?:\/\/[^"'\s>]+/gu));
    expect([...locations]).toEqual([SVG_NS]);
  });

  it("carries no text needing a font the reader may not have", async () => {
    await placeLabel(LATEX);

    expect(reopenExport().querySelectorAll("text")).toHaveLength(0);
  });
});
