// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The naming bar: the one place a source is typed, and the only thing that ever
// tries one. It puts no mark anywhere — what a source becomes, and where, still
// belongs entirely to whoever asked — but it holds the question open until that
// source is known to work, so a refusal is corrected where it was typed.

import type { Source } from "./diagram";
import { messageOf } from "./failure";
import type { PagePoint } from "./render-svg";

/**
 * The one place a source is typed, the line a refusal is put on, and what the
 * bar is currently being asked.
 *
 * There is one input, so there is at most one outstanding question — but that
 * question takes as many `answer`s as it needs, every refused source leaving it
 * open for the next. Held beside the form rather than in it so the bar stays an
 * ordinary element its holder can put anywhere.
 */
interface Bar {
  readonly input: HTMLInputElement;
  readonly reason: HTMLParagraphElement;
  answer?: ((source: Source) => void) | undefined;
}

const bars = new WeakMap<HTMLFormElement, Bar>();

/**
 * The naming bar — a text input, the button that submits what is in it, and the
 * line a source that will not work is refused on — wired and ready to append.
 *
 * It comes back already listening rather than as an inert element a caller has
 * to remember to enable: a bar nothing can answer through is not a useful thing
 * to hold, so there is no moment between the two worth exposing. Where it goes
 * on the page is still theirs to decide — and {@link askForSource} moves it,
 * there being exactly one place a source is typed and it going to whatever it
 * names.
 *
 * The refusal line is its own and answers one question: *why is this still
 * asking me?* The region the canvas keeps answers the other — *why did nothing
 * appear?* — and neither can be put where the other is, a bar that is gone
 * having nothing to say and a corner of the canvas being nowhere to correct a
 * source from.
 */
export function createNamingBar(): HTMLFormElement {
  const form = document.createElement("form");
  form.classList.add("naming-bar");

  const input = document.createElement("input");
  input.type = "text";
  input.name = "latex";
  input.placeholder = "\\Sigma_{(x:A)} P(x)";
  input.setAttribute("aria-label", "LaTeX label");

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Typeset";

  // In the tree before it has anything to say, so a refusal is announced rather
  // than appearing from nowhere. Above the input, and repeating no source back:
  // the source it is about is on the line below, still there to be corrected.
  const reason = document.createElement("p");
  reason.classList.add("naming-error");
  reason.setAttribute("role", "alert");

  form.append(reason, input, button);
  bars.set(form, { input, reason });
  enableAnswering(form);
  return form;
}

/**
 * Ask for a source at a point on the page: the bar leaves its corner, sits
 * there, and stays until `vet` takes a source or the question is given up on.
 *
 * It is the same input, unpinned — not a modal, which would cover the mark it
 * asks about, and not a second field beside a standing bar, which would be two
 * places one source could be typed. Trying the source is the bar's own work
 * rather than the caller's: the bar cannot know it may close until the source is
 * known to work, so `vet` is handed in and whatever it rejects with is put on
 * the line above the input, the source left in place to be corrected and Enter
 * pressed again to retry.
 *
 * Resolves with whatever `vet` handed back, and with nothing at all where the
 * question was given up on: Escape, and equally a submit with nothing in it,
 * there being nothing to name. Those two roads are the whole of how a naming
 * ends, which is why the input is emptied on both and every question opens from
 * nothing typed.
 *
 * The bar is asking before the caller has the promise back — a gesture is what
 * moves it there, and the release that started that gesture is a plausible
 * moment for the first keystroke.
 */
export async function askForSource<Vetted>(
  form: HTMLFormElement,
  at: PagePoint,
  vet: (source: Source) => Promise<Vetted>,
): Promise<Vetted | undefined> {
  const bar = bars.get(form);
  if (!bar) {
    return;
  }
  form.classList.add("asking");
  hangAt(form, at);
  bar.input.focus();

  return await new Promise<Vetted | undefined>((resolve) => {
    let over = false;
    const close = (vetted?: Vetted): void => {
      // A vetting still in flight when the question was given up on lands here
      // afterwards, by which time the bar may already be asking about the next
      // mark: what it hands back belongs to a question nobody is waiting on.
      if (!over) {
        over = true;
        shut(form, bar);
        resolve(vetted);
      }
    };

    bar.answer = (source) => {
      if (source) {
        void vet(source).then(close, (failure: unknown) => {
          if (!over) {
            bar.reason.textContent = messageOf(failure);
          }
        });
      } else {
        close();
      }
    };
  });
}

/**
 * Hang the bar off `at`: the point is where the label goes, and it is the middle
 * of the bar's bottom edge that goes there.
 *
 * By that edge rather than by its top, so a refusal arriving on the line above
 * the input grows the bar upward, away from the mark it is about, instead of
 * pushing the input down over it. Which leaves the width the one thing measured
 * — halved, to centre the bar on the point — and a width is not something a
 * refusal changes.
 *
 * Measured rather than left to a percentage transform, which would be the
 * shorter way to say it and cannot be used: a transform makes a fixed element a
 * composited layer, and the layer lands on the fractional offset half a
 * `ch`-derived width comes to, which WebKit resamples into a blur.
 */
function hangAt(form: HTMLFormElement, at: PagePoint): void {
  const { width } = form.getBoundingClientRect();
  form.style.left = `${String(at.left - width / 2)}px`;
  form.style.bottom = `${String(window.innerHeight - at.top)}px`;
}

/**
 * Put the bar away: it is answering nobody, holds no source and is back in its
 * corner.
 *
 * The one road out of a question, so the input is emptied here and nowhere else
 * — a naming ends on a source that worked or on being given up on, and neither
 * leaves anything the next question could want.
 */
function shut(form: HTMLFormElement, bar: Bar): void {
  bar.answer = undefined;
  bar.input.value = "";
  bar.reason.textContent = "";
  form.classList.remove("asking");
  form.style.removeProperty("left");
  form.style.removeProperty("bottom");
}

/**
 * Make submitting `form` answer whatever it is being asked, and Escape give up
 * on it.
 *
 * A submit with nothing outstanding does nothing at all: the bar names a mark,
 * and there is no mark to name until a gesture asks. It is still stopped from
 * navigating, which a form does whether or not anyone is listening.
 *
 * Escape reads the same whatever state the question is in — a source refused is
 * still a question, and giving up on one is no more work than giving up on a
 * fresh one.
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
