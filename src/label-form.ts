// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { SVG_NS } from "./canvas";
import type { Source } from "./diagram";
import { messageOf } from "./failure";
import { INK } from "./palette";
import type { PagePoint } from "./render-svg";
import { typesetLatex, UNITS_PER_EM } from "./typesetting";

/** Type size of a placed label, in canvas units. */
const LABEL_EM = 24;

/** Where the first label's baseline starts, and how far each next one drops. */
const LABEL_ORIGIN_X = 40;
const LABEL_ORIGIN_Y = 60;
const LABEL_LINE_HEIGHT = 56;

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
 * The LaTeX bar — a text input and the button that typesets what is in it —
 * wired to place onto `canvas` and ready to append.
 *
 * It comes back already listening rather than as an inert element a caller has
 * to remember to enable: a bar that typesets nowhere is not a useful thing to
 * hold, so there is no moment between the two worth exposing. Where it goes on
 * the page is still theirs to decide — and {@link askForSource} moves it, there
 * being exactly one place LaTeX is typed and it going to whatever it names.
 */
export function createLabelForm(canvas: SVGSVGElement): HTMLFormElement {
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

  // Rejected LaTeX never reaches the canvas, so the reason has to show here or
  // the submit looks like it did nothing.
  const error = document.createElement("p");
  error.classList.add("label-error");
  error.setAttribute("role", "alert");

  form.append(input, button, error);
  bars.set(form, { input });
  enableLabelPlacing(canvas, form);
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
  form.style.left = `${String(at.left)}px`;
  form.style.top = `${String(at.top)}px`;
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
 * Make submitting `form` typeset its LaTeX onto `canvas`, and Escape give up on
 * whatever it is being asked.
 *
 * A submit goes to the question the bar is being asked, if it is being asked
 * one, and only otherwise places a label of its own. Labels accumulate the way
 * term-dots do, each one dropping a line below the last so successive submits
 * stay legible rather than piling up on one spot.
 */
function enableLabelPlacing(canvas: SVGSVGElement, form: HTMLFormElement): void {
  // Placements run one at a time: each reads its row off the canvas, so two in
  // flight at once would both see the same row and land on top of each other.
  let pending: Promise<void> = Promise.resolve();

  form.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    const bar = bars.get(form);
    if (!bar) {
      return;
    }
    const latex = bar.input.value.trim();
    if (bar.answer) {
      bar.answer(latex);
      return;
    }
    if (!latex) {
      return;
    }
    pending = pending
      .then(async () => {
        await placeLabel(canvas, latex);
        // Clearing here rather than on submit keeps the message owned by
        // whichever placement finished last: an earlier one still in flight
        // would otherwise report its failure over a later success.
        setError(form, "");
        // Only clear the input once the label is up, and only if the user has
        // not moved on to typing the next one.
        if (bar.input.value.trim() === latex) {
          bar.input.value = "";
        }
      })
      // A rejection must not poison the chain, or one bad label would silence
      // every submit after it. The source stays in the input to be corrected.
      .catch((failure: unknown) => {
        setError(form, messageOf(failure));
      });
  });

  form.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      bars.get(form)?.answer?.("");
    }
  });
}

function setError(form: HTMLFormElement, message: string): void {
  const error = form.querySelector(".label-error");
  if (error) {
    error.textContent = message;
  }
}

/**
 * Typeset `latex` and drop it onto `canvas` as a label.
 *
 * The typesetter returns bare geometry that already carries a transform of its
 * own, so the label is a wrapper around it: the wrapper is what can be moved,
 * named and coloured. Its ink is a presentation attribute rather than a CSS
 * rule, because page CSS does not travel with a serialized `<svg>` and the
 * export has to stand alone.
 */
async function placeLabel(canvas: SVGSVGElement, latex: string): Promise<void> {
  const { glyphs } = await typesetLatex(latex);

  const label = document.createElementNS(SVG_NS, "g");
  label.classList.add("math-label");
  label.setAttribute("color", INK);
  label.append(glyphs);

  // Read the row from the canvas itself rather than a counter: the live tree is
  // the document, so this stays right however labels come and go.
  const row = canvas.querySelectorAll("g.math-label").length;
  const x = LABEL_ORIGIN_X;
  const y = LABEL_ORIGIN_Y + row * LABEL_LINE_HEIGHT;
  label.setAttribute("transform", `translate(${x},${y}) scale(${LABEL_EM / UNITS_PER_EM})`);
  canvas.append(label);
}
