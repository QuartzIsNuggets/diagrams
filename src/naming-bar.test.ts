// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The naming bar: the one place a source is typed, what it answers with, and
// how long it stays. It draws nothing and typesets nothing — the vetting it
// holds a question open for is handed in — so what a source becomes is tested
// where it happens: editor.test.ts for the gestures that ask, render-svg.test.ts
// for the backend that sets one.

import { beforeEach, describe, expect, it } from "vitest";

import type { Source } from "./diagram";
import { askForSource, createNamingBar } from "./naming-bar";

const LATEX = "\\Sigma_{(x:A)} P(x)";

/** Somewhere on the page for the bar to go: the mark a question is about. */
const AT = { left: 300, top: 200 };

/** What a source the backend will not set is refused with. */
const WHY = "undefined control sequence";

let form: HTMLFormElement;

/** A vetting that takes every source: what a working backend does. */
function takes(source: Source): Promise<Source> {
  return Promise.resolve(source);
}

/** A vetting that refuses the first `refusals` sources it is handed. */
function refusing(refusals: number): (source: Source) => Promise<Source> {
  let refused = 0;
  return (source: Source) => {
    refused += 1;
    return refused > refusals ? Promise.resolve(source) : Promise.reject(new Error(WHY));
  };
}

function input(): HTMLInputElement {
  const found = form.querySelector("input");
  if (!found) {
    throw new Error("the bar has lost its input");
  }
  return found;
}

function reasonText(): string {
  return form.querySelector(".naming-error")?.textContent ?? "";
}

/** Type `latex` into the bar and press its button, the way a user would. */
function submit(latex: string): void {
  input().value = latex;
  form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
}

function press(key: string): void {
  form.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/**
 * Let a vetting handed in settle, and whatever the bar does about it.
 *
 * A turn of the event loop rather than a count of microtasks: what a vetting
 * costs is the caller's business, and a test counting ticks would be reading it.
 */
async function settled(): Promise<void> {
  await new Promise((resume) => {
    setTimeout(resume, 0);
  });
}

beforeEach(() => {
  form = createNamingBar();
  document.body.replaceChildren(form);
});

describe("the naming bar", () => {
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

  it("has a line for a refused source before it has one to refuse", () => {
    const line = form.querySelector(".naming-error");

    expect(line?.getAttribute("role")).toBe("alert");
    expect(line?.textContent).toBe("");
    // Above the input, not beside it: the source it is about is the line below.
    expect(line?.nextElementSibling?.tagName).toBe("INPUT");
  });
});

describe("asking for a source", () => {
  it("leaves the bar's corner for the point the question is about", () => {
    form.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 200, 30);

    void askForSource(form, AT, takes);

    expect(form.classList.contains("asking")).toBe(true);
    // Hung by the middle of its bottom edge: half a width left of the point,
    // and as far up from the foot of the window as the point itself is.
    expect([form.style.left, form.style.bottom]).toEqual([
      "200px",
      `${String(window.innerHeight - AT.top)}px`,
    ]);
  });

  it("answers with what the vetting made of the source, and goes back to its corner", async () => {
    const asked = askForSource(form, AT, (source) => Promise.resolve(source.length));

    submit(LATEX);

    await expect(asked).resolves.toBe(LATEX.length);
    expect(form.classList.contains("asking")).toBe(false);
    expect(form.style.left).toBe("");
  });

  it("vets the source typed, never what it would typeset to", async () => {
    const asked = askForSource(form, AT, takes);

    submit(`  ${LATEX}  `);

    await expect(asked).resolves.toBe(LATEX);
  });

  it("vets nothing until there is something typed to vet", async () => {
    const asked = askForSource(form, AT, () => Promise.reject(new Error("asked anyway")));

    submit("   ");

    await expect(asked).resolves.toBeUndefined();
  });
});

describe("a source the vetting refuses", () => {
  it("leaves the bar hung at its mark, holding that source", async () => {
    form.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 200, 30);
    void askForSource(form, AT, refusing(1));

    submit(LATEX);
    await settled();

    expect(form.classList.contains("asking")).toBe(true);
    // Unmoved: the reason lands on the line above, so what the bar hangs by is
    // where it was and the input has not been pushed onto the mark.
    expect([form.style.left, form.style.bottom]).toEqual([
      "200px",
      `${String(window.innerHeight - AT.top)}px`,
    ]);
    expect(input().value).toBe(LATEX);
  });

  it("puts the reason on the line above the input, naming no source", async () => {
    void askForSource(form, AT, refusing(1));

    submit(LATEX);
    await settled();

    expect(reasonText()).toBe(WHY);
    expect(reasonText()).not.toContain(LATEX);
  });
});

describe("correcting a source the vetting refused", () => {
  it("is retried by submitting again, and closes on one that is taken", async () => {
    const asked = askForSource(form, AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("A");

    await expect(asked).resolves.toBe("A");
    expect(form.classList.contains("asking")).toBe(false);
    expect(reasonText()).toBe("");
  });

  it("is given up on by Escape as readily as a fresh one", async () => {
    const asked = askForSource(form, AT, refusing(1));
    submit(LATEX);
    await settled();

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
    expect(form.classList.contains("asking")).toBe(false);
    expect(reasonText()).toBe("");
  });

  it("is given up on by a submit emptied back out, there being nothing to name", async () => {
    const asked = askForSource(form, AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("");

    await expect(asked).resolves.toBeUndefined();
  });
});

describe("giving up on a question", () => {
  it("answers with nothing at all on Escape", async () => {
    const asked = askForSource(form, AT, takes);

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
    expect(form.classList.contains("asking")).toBe(false);
  });

  it("answers the same for a submit with nothing in it, there being nothing to name", async () => {
    const asked = askForSource(form, AT, takes);

    submit("   ");

    await expect(asked).resolves.toBeUndefined();
  });

  it("is not undone by a vetting that lands afterwards", async () => {
    let take: ((source: Source) => void) | undefined;
    const asked = askForSource(
      form,
      AT,
      () =>
        new Promise<Source>((resolve) => {
          take = resolve;
        }),
    );
    submit(LATEX);

    press("Escape");
    take?.(LATEX);

    await expect(asked).resolves.toBeUndefined();
    // The next question is already the bar's own, and a source nobody is
    // waiting on may not close it or empty what is being typed into it.
    void askForSource(form, AT, takes);
    input().value = "B";
    await settled();
    expect(form.classList.contains("asking")).toBe(true);
    expect(input().value).toBe("B");
  });
});

describe("the input between questions", () => {
  it("is emptied by the source that closed the bar, so the next opens from nothing", async () => {
    const asked = askForSource(form, AT, takes);

    submit(LATEX);
    await asked;

    expect(input().value).toBe("");
  });

  it("is emptied by a question given up on too, a refused source going with it", async () => {
    const asked = askForSource(form, AT, refusing(1));
    submit(LATEX);
    await settled();

    press("Escape");
    await asked;

    expect(input().value).toBe("");
  });

  it("keeps what is typed when nothing is being asked, a submit naming nothing", () => {
    submit(LATEX);

    expect(input().value).toBe(LATEX);
    expect(form.classList.contains("asking")).toBe(false);
  });
});
