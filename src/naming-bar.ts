// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The naming bar: the one place a source is typed, and the only thing that ever
// tries one. It puts no mark anywhere — what a source becomes, and where, still
// belongs entirely to whoever asked — but it holds the question open until that
// source is known to work, so a refusal is corrected where it was typed. It is
// on the page for exactly as long as it is asking, so this module both raises it
// and takes it away: nobody else has a bar to hold.

import type { Source } from "./diagram";
import { messageOf } from "./failure";
import type { PagePoint } from "./render-svg";

/**
 * The question on the page: the bar it is being asked through, and what it does
 * with a source typed into it.
 *
 * There is one of these at a time, so there is at most one outstanding question
 * — but that question takes as many `answer`s as it needs, every refused source
 * leaving it open for the next. Nothing stands for a bar that is not asking,
 * because there is no such bar: being on the page and being at a mark are the
 * same fact.
 */
interface Question {
  readonly form: HTMLFormElement;
  readonly answer: (source: Source) => void;
}

let open: Question | undefined;

/**
 * Ask for a source at a point on the page: a bar appears there, and stays until
 * `vet` takes a source or the question is given up on.
 *
 * The bar is summoned at the mark and exists nowhere else — not idling in a
 * corner, which would be a standing invitation to type LaTeX at nothing when
 * every source belongs to some mark; not a modal, which would cover the mark it
 * asks about. Trying the source is the bar's own work rather than the caller's:
 * it cannot know it may go until the source is known to work, so `vet` is handed
 * in and whatever it rejects with is put on the line above the input, the source
 * left in place to be corrected and Enter pressed again to retry.
 *
 * Resolves with whatever `vet` handed back, and with nothing at all where the
 * question was given up on: Escape, and equally a submit with nothing in it,
 * there being nothing to name. Those two roads are the whole of how a naming
 * ends, and either way the bar goes — which is what makes every question start
 * from nothing typed, there being no input left over to carry a source into the
 * next one.
 *
 * A question asked while one is open gives up on that one first: one bar, so a
 * second would be a second place a source could be typed. Callers do not lean on
 * this — the editor starts no gesture while a naming is open — it is what keeps
 * the rule true rather than assumed.
 *
 * The bar is asking before the caller has the promise back — a gesture is what
 * summons it, and the release that started that gesture is a plausible moment
 * for the first keystroke.
 */
export async function askForSource<Vetted>(
  at: PagePoint,
  vet: (source: Source) => Promise<Vetted>,
): Promise<Vetted | undefined> {
  open?.answer("");
  const { form, input, reason } = raise(at);

  return await new Promise<Vetted | undefined>((resolve) => {
    // A vetting still in flight when the question was given up on lands here
    // afterwards, by which time the page may already hold the bar for the next
    // mark: what it hands back belongs to a question nobody is waiting on. That
    // this bar is still the open one is the whole of the test.
    const close = (vetted?: Vetted): void => {
      if (open?.form !== form) {
        return;
      }
      open = undefined;
      form.remove();
      resolve(vetted);
    };

    const answer = (source: Source): void => {
      if (source) {
        void vet(source).then(close, (failure: unknown) => {
          if (open?.form === form) {
            reason.textContent = messageOf(failure);
          }
        });
      } else {
        close();
      }
    };

    open = { form, answer };
    enableAnswering(form, input);
  });
}

/** A bar on the page, and the two parts of it a question needs to reach. */
interface Bar {
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly reason: HTMLParagraphElement;
}

/**
 * The tail's height, and half the edge it stands on.
 *
 * The bar's own number, the way the room a term-dot's label keeps off its dot
 * is the drawing's: it says nothing about a diagram. The stylesheet draws the
 * triangle, and is told this rather than told it twice.
 */
const TAIL = 8;

/**
 * How far short of the mark the tail's point stops.
 *
 * The bar aims at its mark and does not land on it: a term-dot is a few units
 * across and a box's wall is a hairline, and either would be under the bar the
 * moment it touched. So the mark stays there to be read while it is being
 * named.
 */
const MARK_CLEARANCE = 6;

/** How far the bar's body stands off its mark: the tail, and the room it keeps. */
const STANDOFF = TAIL + MARK_CLEARANCE;

/**
 * How near a corner the tail's point may come.
 *
 * A mark far enough out to reach this clamp is within a few pixels of the edge
 * of the window, so the tail points a hair off it — which is a better failure
 * than a tail hanging off a corner, where it would read as belonging to neither
 * edge.
 */
const TAIL_INSET = 16;

/**
 * Put a bar on the page at `at`, focused and ready to be typed into.
 *
 * Built here rather than handed in: a bar is raised by the question and goes
 * with it, so there is no moment at which one exists for a page to hold — which
 * is why it appends itself to the document instead of coming back for someone to
 * place. Where it goes is `at` and nowhere else, and the page has no other say.
 *
 * There is no button. Enter commits and Escape gives up, and a control saying
 * one of them while saying nothing of the other was advertising half the
 * contract — where the bar cannot be reached without typing into it, so the
 * hands are already on both. The one input left is also what makes Enter
 * submit: a form whose only field is a text input is submitted implicitly, so
 * nothing has to listen for the key.
 *
 * The refusal line is in the tree before it has anything to say, so a refusal is
 * announced rather than appearing from nowhere. It answers one question — *why
 * is this still asking me?* — where the region the canvas keeps answers the
 * other, *why did nothing appear?*, and neither can be put where the other is: a
 * bar that is gone has nothing to say, and a corner of the canvas is nowhere to
 * correct a source from.
 */
function raise(at: PagePoint): Bar {
  const form = document.createElement("form");
  form.classList.add("naming-bar");
  form.style.setProperty("--tail-size", `${String(TAIL)}px`);

  const input = document.createElement("input");
  input.type = "text";
  input.name = "latex";
  input.placeholder = "\\Sigma_{(x:A)} P(x)";
  input.setAttribute("aria-label", "LaTeX label");

  // On the input's far side from the mark, wherever that turns out to be: a
  // refusal then grows the bar away from what it is asking about rather than
  // over it, and the edge carrying the tail stays the input's own. It repeats
  // no source back — the source is in the input, still there to be corrected.
  const reason = document.createElement("p");
  reason.classList.add("naming-error");
  reason.setAttribute("role", "alert");

  form.append(reason, input);
  document.body.append(form);
  hangAt(form, at);
  input.focus();
  return { form, input, reason };
}

/**
 * Hang the bar off `at`, tail first: the point is the mark being named, and it
 * is the tail that is aimed at it.
 *
 * The tail owns the mark and the body finds the room. Position alone stopped
 * saying which mark is being named once there was no corner the bar visibly
 * travelled from — term-dots stand as little as a separation apart, and a box's
 * wall is a hairline — so what points is a tail, and the body may go wherever it
 * has to for the tail to keep pointing. Above the mark unless the bar has
 * nowhere to be there, and then below; centred on the mark unless that would put
 * it out of the window, and then shifted along with the tail sliding the other
 * way to stay on the mark. The tail keeps {@link TAIL_INSET} off both corners,
 * which is the one case it stops being exact.
 *
 * The side is settled here and never revisited, and the bar is anchored by the
 * edge the tail is on — `bottom` above the mark, `top` below it — so a refusal
 * arriving grows the bar from its far edge. Neither the tail nor the thing being
 * read moves, which is the whole reason the side is not recomputed: a bar that
 * re-chose its side on the height it happens to have would teleport under a
 * reader's eyes at the worst moment.
 *
 * Fitted inside the **window**, not the canvas. The two are the same rectangle
 * today; the bar is page chrome, and if the canvas ever stops filling the window
 * it is the window the bar has to stay inside. It makes no room for the export
 * control and may sit over it: the bar is transient and is the thing being
 * answered, and teaching it to dodge chrome grows a term every time chrome is
 * added.
 *
 * Measured and placed rather than left to a percentage transform, which would be
 * the shorter way to say it and cannot be used: a transform makes a fixed
 * element a composited layer, and the layer lands on the fractional offset half
 * a `ch`-derived width comes to, which WebKit resamples into a blur. The bar is
 * on the page by now, so there is a rectangle to measure.
 */
function hangAt(form: HTMLFormElement, at: PagePoint): void {
  const { width, height } = form.getBoundingClientRect();

  const under = at.top - STANDOFF - height < 0;
  form.classList.toggle("under-mark", under);
  if (under) {
    form.style.top = `${String(at.top + STANDOFF)}px`;
  } else {
    form.style.bottom = `${String(window.innerHeight - (at.top - STANDOFF))}px`;
  }

  const left = Math.max(0, Math.min(at.left - width / 2, window.innerWidth - width));
  form.style.left = `${String(left)}px`;
  const along = at.left - left;
  form.style.setProperty(
    "--tail-at",
    `${String(Math.min(Math.max(along, TAIL_INSET), width - TAIL_INSET))}px`,
  );
}

/**
 * Make submitting `form` answer whatever it is being asked, and Escape give up
 * on it.
 *
 * The bar is on the page only while it is asking, so a bar reading these events
 * is the open question and there is no state to check first — `open` is its own.
 *
 * Escape reads the same whatever state the question is in — a source refused is
 * still a question, and giving up on one is no more work than giving up on a
 * fresh one. The submit is still stopped from navigating, which a form does
 * whether or not anyone is listening.
 */
function enableAnswering(form: HTMLFormElement, input: HTMLInputElement): void {
  form.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    open?.answer(input.value.trim());
  });

  form.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      open?.answer("");
    }
  });
}
