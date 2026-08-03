// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The LaTeX bar: the one place a source is typed, and what it answers with. It
// draws nothing and typesets nothing, so what a source becomes is tested where
// it happens — editor.test.ts for the gestures that ask, render-svg.test.ts for
// the backend that sets one.

import { beforeEach, describe, expect, it } from "vitest";

import { askForSource, clearSource, createLabelForm } from "./label-form";

const LATEX = "\\Sigma_{(x:A)} P(x)";

/** Somewhere on the page for the bar to go: the mark a question is about. */
const AT = { left: 300, top: 200 };

let form: HTMLFormElement;

function input(): HTMLInputElement {
  const found = form.querySelector("input");
  if (!found) {
    throw new Error("the bar has lost its input");
  }
  return found;
}

/** Type `latex` into the bar and press its button, the way a user would. */
function submit(latex: string): void {
  input().value = latex;
  form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
}

function press(key: string): void {
  form.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => {
  form = createLabelForm();
  document.body.replaceChildren(form);
});

describe("the label form", () => {
  it("offers a text input and a submit affordance", () => {
    expect(input().type).toBe("text");
    expect(input().getAttribute("aria-label")).toBeTruthy();
    expect(form.querySelector("button[type=submit]")).not.toBeNull();
  });

  it("does not navigate away when submitted, asked anything or not", () => {
    const event = new Event("submit", { bubbles: true, cancelable: true });

    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("reports nothing of its own — one region answers for every gesture alike", () => {
    expect(form.querySelector("[role=alert]")).toBeNull();
  });
});

describe("asking for a source", () => {
  it("leaves the bar's corner for the point the question is about", () => {
    form.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 200, 30);

    void askForSource(form, AT);

    expect(form.classList.contains("asking")).toBe(true);
    // The middle of the bar's bottom edge sits on the point, so its corner is
    // half a width left of it and a whole height above.
    expect([form.style.left, form.style.top]).toEqual(["200px", "170px"]);
  });

  it("answers with what was typed, and goes back to its corner", async () => {
    const asked = askForSource(form, AT);

    submit(LATEX);

    await expect(asked).resolves.toBe(LATEX);
    expect(form.classList.contains("asking")).toBe(false);
    expect(form.style.left).toBe("");
  });

  it("answers with the source typed, never with what it would typeset to", async () => {
    const asked = askForSource(form, AT);

    submit(`  ${LATEX}  `);

    await expect(asked).resolves.toBe(LATEX);
  });

  it("leaves what is already typed in place, so a refused source can be corrected", () => {
    input().value = LATEX;

    void askForSource(form, AT);

    expect(input().value).toBe(LATEX);
  });
});

describe("giving up on a question", () => {
  it("answers with nothing at all on Escape", async () => {
    const asked = askForSource(form, AT);

    press("Escape");

    await expect(asked).resolves.toBe("");
    expect(form.classList.contains("asking")).toBe(false);
  });

  it("answers the same for a submit with nothing in it, there being nothing to name", async () => {
    const asked = askForSource(form, AT);

    submit("   ");

    await expect(asked).resolves.toBe("");
  });
});

describe("the input between questions", () => {
  it("is emptied by whoever took the source, so the next is typed from nothing", () => {
    input().value = LATEX;

    clearSource(form);

    expect(input().value).toBe("");
  });

  it("keeps what is typed when nothing is being asked, a submit naming nothing", () => {
    submit(LATEX);

    expect(input().value).toBe(LATEX);
    expect(form.classList.contains("asking")).toBe(false);
  });
});
