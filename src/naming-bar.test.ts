// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The naming bar: the one place a source is typed, what it answers with, and
// how long it stays on the page. It draws nothing and typesets nothing — the
// vetting it holds a question open for is handed in — so what a source becomes
// is tested where it happens: editor.test.ts for the gestures that ask,
// render-svg.test.ts for the backend that sets one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Source } from "./diagram";
import { askForSource } from "./naming-bar";

const LATEX = "\\Sigma_{(x:A)} P(x)";

/** Somewhere on the page for the bar to go: the mark a question is about. */
const AT = { left: 300, top: 200 };

/** What a source the backend will not set is refused with. */
const WHY = "undefined control sequence";

/** The width every bar raised in these tests reports having. */
const WIDTH = 200;

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

/** The bar, if there is one: it is on the page only while it is asking. */
function barOn(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>(".naming-bar");
}

/** The bar there had better be, for a test about what it is doing. */
function bar(): HTMLFormElement {
  const found = barOn();
  if (!found) {
    throw new Error("no bar is asking");
  }
  return found;
}

function input(): HTMLInputElement {
  const found = bar().querySelector("input");
  if (!found) {
    throw new Error("the bar has lost its input");
  }
  return found;
}

function reasonText(): string {
  return bar().querySelector(".naming-error")?.textContent ?? "";
}

/** Type `latex` into the bar and press its button, the way a user would. */
function submit(latex: string): void {
  input().value = latex;
  bar().querySelector<HTMLButtonElement>("button[type=submit]")!.click();
}

function press(key: string): void {
  bar().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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
  document.body.replaceChildren();
  // jsdom has no layout, so every `getBoundingClientRect()` is zeros — and half
  // the bar's width is where it goes, the module centring it on the point
  // rather than translating it there. Stubbed on the prototype because there is
  // no bar to stub until a question raises one.
  vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, WIDTH, 30),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the page while nothing is being named", () => {
  it("holds no bar at all", () => {
    expect(barOn()).toBeNull();
  });

  it("holds none again once a question has been answered", async () => {
    const asked = askForSource(AT, takes);

    submit(LATEX);
    await asked;

    expect(barOn()).toBeNull();
  });

  it("holds none again once a question has been given up on", async () => {
    const asked = askForSource(AT, takes);

    press("Escape");
    await asked;

    expect(barOn()).toBeNull();
  });

  it("holds none again after a refusal the question was corrected through", async () => {
    const asked = askForSource(AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("A");
    await asked;

    expect(barOn()).toBeNull();
  });
});

describe("the bar a question summons", () => {
  it("arrives at the mark, ready to be typed into", () => {
    void askForSource(AT, takes);

    // Hung by the middle of its bottom edge: half a width left of the point,
    // and as far up from the foot of the window as the point itself is.
    expect([bar().style.left, bar().style.bottom]).toEqual([
      `${String(AT.left - WIDTH / 2)}px`,
      `${String(window.innerHeight - AT.top)}px`,
    ]);
    expect(document.activeElement).toBe(input());
  });

  it("offers a text input and a submit affordance", () => {
    void askForSource(AT, takes);

    expect(input().type).toBe("text");
    expect(input().getAttribute("aria-label")).toBeTruthy();
    expect(bar().querySelector("button[type=submit]")).not.toBeNull();
  });

  it("has a line for a refused source before it has one to refuse", () => {
    void askForSource(AT, takes);

    const line = bar().querySelector(".naming-error");
    expect(line?.getAttribute("role")).toBe("alert");
    expect(line?.textContent).toBe("");
    // Above the input, not beside it: the source it is about is the line below.
    expect(line?.nextElementSibling?.tagName).toBe("INPUT");
  });

  it("does not navigate away when submitted", () => {
    void askForSource(AT, takes);
    const event = new Event("submit", { bubbles: true, cancelable: true });

    bar().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("asking for a source", () => {
  it("answers with what the vetting made of the source", async () => {
    const asked = askForSource(AT, (source) => Promise.resolve(source.length));

    submit(LATEX);

    await expect(asked).resolves.toBe(LATEX.length);
  });

  it("vets the source typed, never what it would typeset to", async () => {
    const asked = askForSource(AT, takes);

    submit(`  ${LATEX}  `);

    await expect(asked).resolves.toBe(LATEX);
  });

  it("vets nothing until there is something typed to vet", async () => {
    const asked = askForSource(AT, () => Promise.reject(new Error("asked anyway")));

    submit("   ");

    await expect(asked).resolves.toBeUndefined();
  });

  it("opens from nothing typed, the bar holding a question being a new one", async () => {
    const asked = askForSource(AT, takes);
    submit(LATEX);
    await asked;

    void askForSource(AT, takes);

    expect(input().value).toBe("");
  });
});

describe("a source the vetting refuses", () => {
  it("leaves the bar hung at its mark, holding that source", async () => {
    void askForSource(AT, refusing(1));

    submit(LATEX);
    await settled();

    // Unmoved: the reason lands on the line above, so what the bar hangs by is
    // where it was and the input has not been pushed onto the mark.
    expect([bar().style.left, bar().style.bottom]).toEqual([
      `${String(AT.left - WIDTH / 2)}px`,
      `${String(window.innerHeight - AT.top)}px`,
    ]);
    expect(input().value).toBe(LATEX);
  });

  it("puts the reason on the line above the input, naming no source", async () => {
    void askForSource(AT, refusing(1));

    submit(LATEX);
    await settled();

    expect(reasonText()).toBe(WHY);
    expect(reasonText()).not.toContain(LATEX);
  });
});

describe("correcting a source the vetting refused", () => {
  it("is retried by submitting again, and answers with the one that is taken", async () => {
    const asked = askForSource(AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("A");

    await expect(asked).resolves.toBe("A");
  });

  it("is given up on by Escape as readily as a fresh one", async () => {
    const asked = askForSource(AT, refusing(1));
    submit(LATEX);
    await settled();

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
  });

  it("is given up on by a submit emptied back out, there being nothing to name", async () => {
    const asked = askForSource(AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("");

    await expect(asked).resolves.toBeUndefined();
  });
});

describe("giving up on a question", () => {
  it("answers with nothing at all on Escape", async () => {
    const asked = askForSource(AT, takes);

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
  });

  it("answers the same for a submit with nothing in it, there being nothing to name", async () => {
    const asked = askForSource(AT, takes);

    submit("   ");

    await expect(asked).resolves.toBeUndefined();
  });

  it("is not undone by a vetting that lands afterwards", async () => {
    let take: ((source: Source) => void) | undefined;
    const asked = askForSource(
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
    // The next question has a bar of its own, and a source nobody is waiting on
    // may not take it off the page or answer with what is being typed into it.
    void askForSource(AT, takes);
    input().value = "B";
    await settled();
    expect(input().value).toBe("B");
  });
});

describe("a second question asked while one is open", () => {
  it("leaves one bar on the page, the one asking about the newer mark", () => {
    void askForSource(AT, takes);

    void askForSource({ left: 500, top: 400 }, takes);

    expect(document.querySelectorAll(".naming-bar")).toHaveLength(1);
    expect(bar().style.bottom).toBe(`${String(window.innerHeight - 400)}px`);
  });

  it("gives up on the one it displaced, rather than leaving it unanswered", async () => {
    const first = askForSource(AT, takes);

    void askForSource(AT, takes);

    await expect(first).resolves.toBeUndefined();
  });
});
