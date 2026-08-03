// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The LaTeX bar: the one place a source is typed, and nothing more. It puts no
// mark anywhere — it is asked for a source and it answers with one — so what a
// source becomes, and where, belongs entirely to whoever asked.

import type { Source } from "./diagram";
import type { PagePoint } from "./render-svg";

/**
 * The one place LaTeX is typed, and what it is currently being asked.
 *
 * There is one input, so there is at most one outstanding question, and
 * `answer` is that question's one reply. Held beside the form rather than in it
 * so the bar stays an ordinary element its holder can put anywhere.
 */
interface Bar {
  readonly input: HTMLInputElement;
  answer?: ((source: Source) => void) | undefined;
}

const bars = new WeakMap<HTMLFormElement, Bar>();

/**
 * The LaTeX bar — a text input and the button that submits what is in it —
 * wired and ready to append.
 *
 * It comes back already listening rather than as an inert element a caller has
 * to remember to enable: a bar nothing can answer through is not a useful thing
 * to hold, so there is no moment between the two worth exposing. Where it goes
 * on the page is still theirs to decide — and {@link askForSource} moves it,
 * there being exactly one place LaTeX is typed and it going to whatever it
 * names.
 *
 * It reports nothing of its own. A source that will not typeset is refused by
 * the backend that would have drawn it, which is what the gesture that asked
 * hears, and one region says so for every gesture alike — a second one here
 * would be two error surfaces answering one question.
 */
export function createLabelForm(): HTMLFormElement {
  const form = document.createElement("form");
  form.classList.add("label-form");

  const input = document.createElement("input");
  input.type = "text";
  input.name = "latex";
  input.classList.add("label-input");
  input.placeholder = "\\Sigma_{(x:A)} P(x)";
  input.setAttribute("aria-label", "LaTeX label");

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Typeset";

  form.append(input, button);
  bars.set(form, { input });
  enableAnswering(form);
  return form;
}

/**
 * Ask for a source at a point on the page: the bar leaves its corner and sits
 * there until the question is answered.
 *
 * It is the same input, unpinned — not a modal, which would cover the mark it
 * asks about, and not a second field beside the standing bar, which would be two
 * error surfaces answering one question. What is already typed is left in place
 * and selected, so a source a gesture refused can be corrected rather than
 * retyped.
 *
 * Resolves with what was typed, and with the empty source where the question
 * was given up on: Escape, and equally a submit with nothing in it, there being
 * nothing to name.
 */
export function askForSource(form: HTMLFormElement, at: PagePoint): Promise<Source> {
  const bar = bars.get(form);
  if (!bar) {
    return Promise.resolve("");
  }
  form.classList.add("asking");
  // The point is where the label goes, which is the middle of the bar's bottom
  // edge, so the corner it is placed by is that point less half its width and
  // all of its height. Measured rather than left to a percentage transform,
  // which would blur it — see `.label-form.asking` in the stylesheet.
  const { width, height } = form.getBoundingClientRect();
  form.style.left = `${String(at.left - width / 2)}px`;
  form.style.top = `${String(at.top - height)}px`;
  bar.input.focus();
  bar.input.select();

  return new Promise((resolve) => {
    bar.answer = (source) => {
      bar.answer = undefined;
      form.classList.remove("asking");
      form.style.removeProperty("left");
      form.style.removeProperty("top");
      resolve(source);
    };
  });
}

/** Empty the input: what it held has landed, and the next source can be typed. */
export function clearSource(form: HTMLFormElement): void {
  const bar = bars.get(form);
  if (bar) {
    bar.input.value = "";
  }
}

/**
 * Make submitting `form` answer whatever it is being asked, and Escape give up
 * on it.
 *
 * A submit with nothing outstanding does nothing at all: the bar names a mark,
 * and there is no mark to name until a gesture asks. It is still stopped from
 * navigating, which a form does whether or not anyone is listening.
 */
function enableAnswering(form: HTMLFormElement): void {
  form.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    const bar = bars.get(form);
    bar?.answer?.(bar.input.value.trim());
  });

  form.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      bars.get(form)?.answer?.("");
    }
  });
}
