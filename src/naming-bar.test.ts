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
import { askForSource, pressElsewhere, whileNaming } from "./naming-bar";
import type { PagePoint } from "./render-svg";

const LATEX = "\\Sigma_{(x:A)} P(x)";

/** Somewhere on the page for the bar to go: the mark a question is about. */
const AT = { left: 300, top: 200 };

/** What a source the backend will not set is refused with. */
const WHY = "undefined control sequence";

/** The width and height every bar raised in these tests reports having. */
const WIDTH = 200;
const HEIGHT = 30;

/**
 * How far the bar's body stands off the mark its tail points at, and how near
 * a corner that tail may come.
 *
 * Read off the module's own look numbers rather than imported: what the bar
 * leaves between itself and a dot is the bar's to change, and a test naming it
 * is what says the change was meant.
 */
const STANDOFF = 14;
const TAIL_INSET = 16;

/** Where along the bar's own top or bottom edge the tail is pointing. */
function tailAt(): string {
  return bar().style.getPropertyValue("--tail-at");
}

/** Which side of its mark the bar took. */
function under(): boolean {
  return bar().classList.contains("under-mark");
}

/** Whether the bar is mid-swing, which is how it refuses a press. */
function swinging(): boolean {
  return bar().classList.contains("press-refused");
}

/** A vetting that takes every source: what a working backend does. */
function takes(source: Source): Promise<Source> {
  return Promise.resolve(source);
}

/**
 * Ask about a mark that can stand unnamed.
 *
 * Which naming a question is about decides one thing only — what an incidental
 * press does to it — so it is named where that is what is being tested and this
 * stands for it everywhere else.
 */
function ask<Vetted>(
  at: PagePoint,
  vet: (source: Source) => Promise<Vetted>,
): Promise<Vetted | undefined> {
  return askForSource(at, "optional", vet);
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

/**
 * Type `latex` into the bar and commit it, the way a user would.
 *
 * `requestSubmit` because there is no button to click: what a user presses is
 * Enter, and a form whose only field is a text input submits implicitly — which
 * jsdom does not do, having no implicit submission at all.
 */
function submit(latex: string): void {
  input().value = latex;
  bar().requestSubmit();
}

function press(key: string): void {
  bar().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/**
 * Start watching, and read back everything the bar has said since — the first
 * entry being what it said on being asked.
 *
 * A log rather than a latest value: how often the bar speaks is as much of the
 * claim as what it says.
 */
function watched(): boolean[] {
  const said: boolean[] = [];
  whileNaming((asking) => said.push(asking));
  return said;
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
  // jsdom has no layout, so every `getBoundingClientRect()` is zeros — and the
  // bar's own rectangle is what it finds room by, the module placing it rather
  // than translating it there. Stubbed on the prototype because there is no bar
  // to stub until a question raises one.
  vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, WIDTH, HEIGHT),
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
    const asked = ask(AT, takes);

    submit(LATEX);
    await asked;

    expect(barOn()).toBeNull();
  });

  it("holds none again once a question has been given up on", async () => {
    const asked = ask(AT, takes);

    press("Escape");
    await asked;

    expect(barOn()).toBeNull();
  });

  it("holds none again after a refusal the question was corrected through", async () => {
    const asked = ask(AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("A");
    await asked;

    expect(barOn()).toBeNull();
  });
});

describe("the bar a question summons", () => {
  it("arrives at the mark, ready to be typed into", () => {
    void ask(AT, takes);

    // Above the mark and standing clear of it: the tail spans the gap, so the
    // bar's bottom edge is a standoff up from the point and its middle is over
    // the point, which is where the tail comes down.
    expect(under()).toBe(false);
    expect([bar().style.left, bar().style.bottom, tailAt()]).toEqual([
      `${String(AT.left - WIDTH / 2)}px`,
      `${String(window.innerHeight - AT.top + STANDOFF)}px`,
      `${String(WIDTH / 2)}px`,
    ]);
    expect(document.activeElement).toBe(input());
  });

  it("offers a text input and nothing to press", () => {
    void ask(AT, takes);

    expect(input().type).toBe("text");
    expect(input().getAttribute("aria-label")).toBeTruthy();
    // Enter commits and Escape gives up; a button saying one of them and
    // nothing of the other was advertising half the contract.
    expect(bar().querySelector("button")).toBeNull();
  });

  it("has a line for a refused source before it has one to refuse", () => {
    void ask(AT, takes);

    const line = bar().querySelector(".naming-error");
    expect(line?.getAttribute("role")).toBe("alert");
    expect(line?.textContent).toBe("");
    // The input's far side from the mark, which above the mark is the line over
    // it: the source the reason is about is the one still in the input.
    expect(line?.nextElementSibling?.tagName).toBe("INPUT");
  });

  it("does not navigate away when submitted", () => {
    void ask(AT, takes);
    const event = new Event("submit", { bubbles: true, cancelable: true });

    bar().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});

/** A mark too near the head of the window for a bar to stand above it. */
const HIGH = { left: 300, top: STANDOFF + HEIGHT - 1 };

describe("the side of the mark the bar takes", () => {
  it("is the other one where it cannot stand above, tail with it", () => {
    void ask(HIGH, takes);

    // Hung by its top edge now, which is the edge the tail is on, so the same
    // standoff is measured the other way and a refusal grows it downward.
    expect(under()).toBe(true);
    expect([bar().style.top, bar().style.bottom]).toEqual([`${String(HIGH.top + STANDOFF)}px`, ""]);
    expect(tailAt()).toBe(`${String(WIDTH / 2)}px`);
  });

  it("puts the refusal line below the input there, away from the mark", () => {
    void ask(HIGH, takes);

    // Same tree either way — the stylesheet reads the side and reverses the
    // column, so the line is on the input's far side from the mark whichever
    // side that is.
    expect(bar().classList.contains("under-mark")).toBe(true);
    expect(bar().firstElementChild?.classList.contains("naming-error")).toBe(true);
  });
});

describe("the room the bar's body finds along an edge", () => {
  it("shifts it inside the window, the tail sliding to keep pointing", () => {
    const near = { left: 40, top: 200 };

    void ask(near, takes);

    // Centred would have hung it off the left edge, so the body sits flush
    // against it and the tail moves to where the mark is along that edge.
    expect(bar().style.left).toBe("0px");
    expect(tailAt()).toBe(`${String(near.left)}px`);
  });

  it("shifts it at the other edge too", () => {
    const near = { left: window.innerWidth - 40, top: 200 };

    void ask(near, takes);

    expect(bar().style.left).toBe(`${String(window.innerWidth - WIDTH)}px`);
    expect(tailAt()).toBe(`${String(WIDTH - 40)}px`);
  });

  it("stops the tail short of a corner, a mark that extreme being off the edge", () => {
    void ask({ left: 2, top: 200 }, takes);

    expect(bar().style.left).toBe("0px");
    expect(tailAt()).toBe(`${String(TAIL_INSET)}px`);
  });

  it("makes no room for the export control and may sit over it", () => {
    const controls = document.createElement("div");
    controls.classList.add("export-controls");
    document.body.append(controls);
    const corner = { left: window.innerWidth - WIDTH / 2, top: 200 };

    void ask(corner, takes);

    // Placed on its mark as if the corner were empty: the bar is transient and
    // is the thing being answered, so it is the control that is sat over.
    expect(bar().style.left).toBe(`${String(window.innerWidth - WIDTH)}px`);
    expect(tailAt()).toBe(`${String(WIDTH / 2)}px`);
  });
});

describe("asking for a source", () => {
  it("answers with what the vetting made of the source", async () => {
    const asked = ask(AT, (source) => Promise.resolve(source.length));

    submit(LATEX);

    await expect(asked).resolves.toBe(LATEX.length);
  });

  it("vets the source typed, never what it would typeset to", async () => {
    const asked = ask(AT, takes);

    submit(`  ${LATEX}  `);

    await expect(asked).resolves.toBe(LATEX);
  });

  it("vets nothing until there is something typed to vet", async () => {
    const asked = ask(AT, () => Promise.reject(new Error("asked anyway")));

    submit("   ");

    await expect(asked).resolves.toBeUndefined();
  });

  it("opens from nothing typed, the bar holding a question being a new one", async () => {
    const asked = ask(AT, takes);
    submit(LATEX);
    await asked;

    void ask(AT, takes);

    expect(input().value).toBe("");
  });
});

describe("a source the vetting refuses", () => {
  it("leaves the bar hung at its mark, holding that source", async () => {
    void ask(AT, refusing(1));

    submit(LATEX);
    await settled();

    // Unmoved: the bar hangs by the edge its tail is on and the reason lands on
    // the far side of the input, so the bar grows away from the mark and the
    // tail stays on it.
    expect([bar().style.left, bar().style.bottom, tailAt()]).toEqual([
      `${String(AT.left - WIDTH / 2)}px`,
      `${String(window.innerHeight - AT.top + STANDOFF)}px`,
      `${String(WIDTH / 2)}px`,
    ]);
    expect(input().value).toBe(LATEX);
  });

  it("does not send the bar to the other side of its mark", async () => {
    // Standing above its mark by exactly nothing to spare.
    const tight = { left: 300, top: STANDOFF + HEIGHT };
    void ask(tight, refusing(1));
    // The reason's line, arriving: a bar choosing its side again now would find
    // no room above and flip under the mark being read.
    vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, WIDTH, 2 * HEIGHT),
    );

    submit(LATEX);
    await settled();

    expect(under()).toBe(false);
    expect(bar().style.bottom).toBe(`${String(window.innerHeight - tight.top + STANDOFF)}px`);
  });

  it("puts the reason on the line above the input, naming no source", async () => {
    void ask(AT, refusing(1));

    submit(LATEX);
    await settled();

    expect(reasonText()).toBe(WHY);
    expect(reasonText()).not.toContain(LATEX);
  });
});

describe("correcting a source the vetting refused", () => {
  it("is retried by submitting again, and answers with the one that is taken", async () => {
    const asked = ask(AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("A");

    await expect(asked).resolves.toBe("A");
  });

  it("is given up on by Escape as readily as a fresh one", async () => {
    const asked = ask(AT, refusing(1));
    submit(LATEX);
    await settled();

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
  });

  it("is given up on by a submit emptied back out, there being nothing to name", async () => {
    const asked = ask(AT, refusing(1));
    submit(LATEX);
    await settled();

    submit("");

    await expect(asked).resolves.toBeUndefined();
  });
});

describe("giving up on a question", () => {
  it("answers with nothing at all on Escape", async () => {
    const asked = ask(AT, takes);

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
  });

  it("answers the same for a submit with nothing in it, there being nothing to name", async () => {
    const asked = ask(AT, takes);

    submit("   ");

    await expect(asked).resolves.toBeUndefined();
  });

  it("is not undone by a vetting that lands afterwards", async () => {
    let take: ((source: Source) => void) | undefined;
    const asked = ask(
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
    void ask(AT, takes);
    input().value = "B";
    await settled();
    expect(input().value).toBe("B");
  });
});

describe("a press elsewhere while a mark that can stand unnamed is being named", () => {
  it("gives up on the question and lets the press go on", async () => {
    const asked = ask(AT, takes);

    expect(pressElsewhere()).toBe("goes-on");

    await expect(asked).resolves.toBeUndefined();
    expect(barOn()).toBeNull();
  });

  it("gives up on a refused source as readily, the mark standing unnamed either way", async () => {
    const asked = ask(AT, refusing(1));
    submit(LATEX);
    await settled();

    expect(pressElsewhere()).toBe("goes-on");

    await expect(asked).resolves.toBeUndefined();
  });
});

describe("a press elsewhere while a mark that is its label is being named", () => {
  it("is refused: the question stays open, holding its source, and the bar swings", async () => {
    const asked = askForSource(AT, "required", refusing(1));
    submit(LATEX);
    await settled();

    expect(pressElsewhere()).toBe("refused");

    expect(swinging()).toBe(true);
    expect(input().value).toBe(LATEX);
    expect(reasonText()).toBe(WHY);
    // Still asking: nothing has been answered, and Escape is still the way out.
    press("Escape");
    await expect(asked).resolves.toBeUndefined();
  });

  it("swings again for the press after, the swing being a thing that happened", () => {
    void askForSource(AT, "required", takes);

    pressElsewhere();
    // A bare Event: jsdom animates nothing and has no AnimationEvent to raise,
    // and what the bar reads of one is that it ended.
    bar().dispatchEvent(new Event("animationend"));
    expect(swinging()).toBe(false);
    pressElsewhere();

    expect(swinging()).toBe(true);
  });

  it("is done saying so when an animation inside the bar ends, not only one on it", () => {
    void askForSource(AT, "required", takes);

    pressElsewhere();
    // What a reader who wants no motion gets is colour run over the input's
    // edge rather than a swing of the bar, so the animation that ends is the
    // input's and the bar hears it by bubbling. A refusal that ended on
    // nothing would leave the class on and swallow every press after it.
    input().dispatchEvent(new Event("animationend", { bubbles: true }));

    expect(swinging()).toBe(false);
  });

  it("is what Escape is not: that gives up on a required naming too", async () => {
    const asked = askForSource(AT, "required", takes);

    press("Escape");

    await expect(asked).resolves.toBeUndefined();
    expect(barOn()).toBeNull();
  });
});

describe("a press elsewhere while nothing is being named", () => {
  it("is free to go on, there being no question for it to be incidental to", () => {
    expect(pressElsewhere()).toBe("goes-on");
  });
});

describe("a second question asked while one is open", () => {
  it("leaves one bar on the page, the one asking about the newer mark", () => {
    void ask(AT, takes);

    void ask({ left: 500, top: 400 }, takes);

    expect(document.querySelectorAll(".naming-bar")).toHaveLength(1);
    expect(bar().style.bottom).toBe(`${String(window.innerHeight - 400 + STANDOFF)}px`);
  });

  it("gives up on the one it displaced, rather than leaving it unanswered", async () => {
    const first = ask(AT, takes);

    void ask(AT, takes);

    await expect(first).resolves.toBeUndefined();
  });

  it("closes the naming and opens another, in that order and not as one", async () => {
    const first = ask(AT, takes);
    const said = watched();

    void ask({ left: 500, top: 400 }, takes);
    await first;

    // The gap between the two is real — the first bar goes before the second is
    // raised — and it is a synchronous one no press or paint fits inside.
    expect(said).toEqual([true, false, true]);
  });
});

// Whether a naming is open is the one thing the bar says about itself to
// something that is not a gesture — the export control, which may not emit a
// drawing that is missing the mark being named. What it does about being told is
// `export-svg.test.ts`'s; that it is told is here.
describe("what the bar tells a watcher on being asked", () => {
  it("says none is open where none is, so nothing has to assume it", async () => {
    // The quiet page, made rather than relied on: another test's bar may still
    // be up when this one starts.
    const asked = ask(AT, takes);
    press("Escape");
    await asked;

    expect(watched()).toEqual([false]);
  });

  it("says one is where one is, a watcher being free to arrive mid-question", () => {
    void ask(AT, takes);

    expect(watched()).toEqual([true]);
  });
});

describe("what the bar says as a question opens and closes", () => {
  it("says one is open the moment a bar is raised", () => {
    const said = watched();

    void ask(AT, takes);

    expect(said.at(-1)).toBe(true);
  });

  it("says none is again once the source is taken", async () => {
    const asked = ask(AT, takes);
    const said = watched();

    submit(LATEX);
    await asked;

    expect(said).toEqual([true, false]);
  });

  it("says none is again when the question is given up on", async () => {
    const asked = ask(AT, takes);
    const said = watched();

    press("Escape");
    await asked;

    expect(said).toEqual([true, false]);
  });

  it("says none is again when a press elsewhere cancelled it", async () => {
    const asked = ask(AT, takes);
    const said = watched();

    pressElsewhere();
    await asked;

    expect(said).toEqual([true, false]);
  });
});

// Said once each way and no more: a control told a question is open while it is
// already standing down is one somebody makes idempotent rather than leaves be.
describe("what closes no question, the bar says nothing new about", () => {
  it("a source the vetting refused, the bar staying at its mark", async () => {
    void ask(AT, refusing(1));
    const said = watched();

    submit(LATEX);
    await settled();

    expect(said).toEqual([true]);
  });

  it("a press it refused, the question standing with its source in it", () => {
    void askForSource(AT, "required", takes);
    const said = watched();

    pressElsewhere();

    expect(said).toEqual([true]);
  });
});
