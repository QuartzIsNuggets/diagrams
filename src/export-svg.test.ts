// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// Serializing the canvas to a standalone file. The tests below export real
// content — dots plopped through `enablePlopping`, a label typeset through the
// real MathJax pipeline — because an export is only worth anything if what is
// on screen survives the trip.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas, enablePlopping, SVG_NS } from "./canvas";
import { createExportButton, serializeCanvas } from "./export-svg";
import { createLabelForm } from "./label-form";

const LATEX = "\\Sigma_{(x:A)} P(x)";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

/** What the browser was asked to save: the file's name and its bytes. */
interface Download {
  filename: string;
  blob: Blob;
  url: string;
}

let canvas: SVGSVGElement;
let button: HTMLButtonElement;
let downloads: Download[];
let revoked: string[];

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

/** Press Export and read back the file the browser was handed. */
function exportOnce(): Download {
  button.click();
  const download = downloads.at(-1);
  if (!download) {
    throw new Error("pressing Export handed the browser no file");
  }
  return download;
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

const anchorClick = HTMLAnchorElement.prototype.click;
const { createObjectURL, revokeObjectURL } = URL;

beforeEach(() => {
  canvas = createCanvas();
  enablePlopping(canvas);
  button = createExportButton(canvas);
  document.body.replaceChildren(canvas, button);
  sizeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);

  // jsdom implements neither object URLs nor downloads, so both ends of the
  // hand-off are stood in for: the blob is kept so its bytes can be read, and
  // the anchor is caught instead of navigating.
  downloads = [];
  revoked = [];
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (blob: Blob): string => {
    const url = `blob:test/${String(blobs.size)}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    const blob = blobs.get(this.href);
    if (blob) {
      downloads.push({ filename: this.download, blob, url: this.href });
    }
  };
});

afterEach(() => {
  HTMLAnchorElement.prototype.click = anchorClick;
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

describe("the export affordance", () => {
  it("is a button that says what it does", () => {
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBeTruthy();
  });

  it("does not submit whatever form it may end up inside", () => {
    expect(button.type).toBe("button");
  });

  it("carries the class that puts it on screen, so it is there to be pressed", () => {
    // jsdom applies no stylesheet, so the class is as far as this can go: where
    // `.export-button` actually lands is `style.css`'s to answer.
    expect(button.classList.contains("export-button")).toBe(true);
  });
});

describe("pressing Export", () => {
  it("hands the browser a file to save", () => {
    expect(exportOnce().filename).toMatch(/\.svg$/u);
  });

  it("saves it as SVG, so the file opens as a drawing and not as text", () => {
    expect(exportOnce().blob.type).toMatch(/^image\/svg\+xml\b/u);
  });

  it("saves the serialized canvas itself", async () => {
    plopDotAt(120, 45);

    await expect(exportOnce().blob.text()).resolves.toBe(serializeCanvas(canvas));
  });

  it("releases the blob URL once the browser has taken it", () => {
    vi.useFakeTimers();
    try {
      const { url } = exportOnce();
      expect(revoked).toEqual([]);
      vi.runAllTimers();
      expect(revoked).toEqual([url]);
    } finally {
      vi.useRealTimers();
    }
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
