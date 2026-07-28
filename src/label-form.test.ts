// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The LaTeX bar and what it puts on the canvas. The typesetting engine behind
// it is covered in mathjax-label.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvas } from "./canvas";
import { createLabelForm, enableLabelPlacing } from "./mathjax-label";

const LATEX = "\\Sigma_{(x:A)} P(x)";

let canvas: SVGSVGElement;
let form: HTMLFormElement;

function labelsOf(): SVGGElement[] {
  return [...canvas.querySelectorAll<SVGGElement>("g.math-label")];
}

/** Type `latex` into the form and press its submit button, the way a user would. */
function submit(latex: string): void {
  form.querySelector("input")!.value = latex;
  form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
}

/** Wait for the fire-and-forget submit handler to land `count` labels. */
async function waitForLabels(count: number): Promise<SVGGElement[]> {
  await vi.waitFor(() => expect(labelsOf()).toHaveLength(count));
  return labelsOf();
}

beforeEach(() => {
  canvas = createCanvas();
  form = createLabelForm();
  enableLabelPlacing(canvas, form);
  document.body.replaceChildren(canvas, form);
});

describe("the label form", () => {
  it("offers a text input and a submit affordance", () => {
    const input = form.querySelector("input");
    expect(input?.type).toBe("text");
    expect(input?.getAttribute("aria-label")).toBeTruthy();
    expect(form.querySelector("button[type=submit]")).not.toBeNull();
  });

  it("does not navigate away when submitted", () => {
    const event = new Event("submit", { bubbles: true, cancelable: true });

    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("placing a typeset label", () => {
  it("appends it to the canvas on submit", async () => {
    submit(LATEX);

    const [label] = await waitForLabels(1);
    expect(label?.parentNode).toBe(canvas);
    expect(label?.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("scales and positions it with a transform, so it lands somewhere visible", async () => {
    submit(LATEX);

    const [label] = await waitForLabels(1);
    expect(label?.getAttribute("transform")).toMatch(
      /^translate\([\d.]+,[\d.]+\) scale\([\d.]+\)$/u,
    );
  });

  it("stacks each new label clear of the last instead of piling them up", async () => {
    submit(LATEX);
    await waitForLabels(1);
    submit("P(x)");

    const transforms = (await waitForLabels(2)).map((label) => label.getAttribute("transform"));
    expect(transforms[0]).not.toBe(transforms[1]);
  });

  it("ignores a blank input", async () => {
    submit("   ");
    submit(LATEX);

    // The blank submit would have landed first had it landed at all.
    const [label] = await waitForLabels(1);
    expect(label?.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});

describe("the input after a label lands", () => {
  it("is cleared, so the next label can be typed straight away", async () => {
    submit(LATEX);
    await waitForLabels(1);

    expect(form.querySelector("input")?.value).toBe("");
  });

  it("keeps whatever was typed while the label was still typesetting", async () => {
    const input = form.querySelector("input")!;
    submit(LATEX);
    input.value = "P(y)";

    await waitForLabels(1);
    expect(input.value).toBe("P(y)");
  });
});

describe("a label that will not typeset", () => {
  const BAD = "\\notacontrolsequence{x}";

  it("puts nothing on the canvas and says why", async () => {
    submit(BAD);

    await vi.waitFor(() =>
      expect(form.querySelector(".label-error")?.textContent).toMatch(
        /undefined control sequence/iu,
      ),
    );
    expect(labelsOf()).toHaveLength(0);
  });

  it("keeps the source in the input so it can be corrected", async () => {
    submit(BAD);
    await vi.waitFor(() => expect(form.querySelector(".label-error")?.textContent).toBeTruthy());

    expect(form.querySelector("input")?.value).toBe(BAD);
  });

  it("does not stop the labels that follow it", async () => {
    submit(BAD);
    submit(LATEX);

    const [label] = await waitForLabels(1);
    expect(label?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(form.querySelector(".label-error")?.textContent).toBe("");
  });
});
