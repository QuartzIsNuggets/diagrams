// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { SVG_NS } from "./canvas";
import { INK } from "./palette";
import { typesetLatex, UNITS_PER_EM } from "./typesetting";

/** Type size of a placed label, in canvas units. */
const LABEL_EM = 24;

/** Where the first label's baseline starts, and how far each next one drops. */
const LABEL_ORIGIN_X = 40;
const LABEL_ORIGIN_Y = 60;
const LABEL_LINE_HEIGHT = 56;

/**
 * The LaTeX bar — a text input and the button that typesets what is in it —
 * wired to place onto `canvas` and ready to append.
 *
 * It comes back already listening rather than as an inert element a caller has
 * to remember to enable: a bar that typesets nowhere is not a useful thing to
 * hold, so there is no moment between the two worth exposing. Where it goes on
 * the page is still theirs to decide.
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
  enableLabelPlacing(canvas, form);
  return form;
}

/**
 * Make submitting `form` typeset its LaTeX onto `canvas`.
 *
 * Labels accumulate the way term-dots do, each one dropping a line below the
 * last so successive submits stay legible rather than piling up on one spot.
 */
function enableLabelPlacing(canvas: SVGSVGElement, form: HTMLFormElement): void {
  // Placements run one at a time: each reads its row off the canvas, so two in
  // flight at once would both see the same row and land on top of each other.
  let pending: Promise<void> = Promise.resolve();

  form.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    const input = form.querySelector("input");
    const latex = input?.value.trim();
    if (!input || !latex) {
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
        if (input.value.trim() === latex) {
          input.value = "";
        }
      })
      // A rejection must not poison the chain, or one bad label would silence
      // every submit after it. The source stays in the input to be corrected.
      .catch((failure: unknown) => {
        setError(form, failure instanceof Error ? failure.message : String(failure));
      });
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
  const glyphs = await typesetLatex(latex);

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
