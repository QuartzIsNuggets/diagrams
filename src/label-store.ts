// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// What each source has been set to: its glyph run, or the refusal there was
// instead. Nothing here draws, and nothing here knows a diagram — a store is
// handed sources and knows nothing of the boxes or dots they came off, so which
// labels a render backend draws stays that backend's own knowledge.
//
// The rule the module exists to keep is that **asking retries, drawing
// replays**. Someone re-submitting a source is asking for exactly that, and a
// boot the engine got wrong once must not leave that source unsettable for the
// session; a redraw asks nothing and takes the remembered answer, or every frame
// would retry every source that will not set and report it again. Three doors,
// each naming which of the two it is, so no caller is left to remember the
// difference.
//
// A refusal is kept as the refusal rather than as a note about one, so whoever
// asks next is told exactly what the first caller was.
//
// This module's own word, and deliberately not the glossary's: what a source has
// come to is **set**, and the glossary avoids `store` for it because that names
// the mechanism. Naming the mechanism is exactly this file's job — a store is
// what keeps the promise, and only the doors it opens are the promise itself.

import type { Source } from "./diagram";
import { messageOf } from "./failure";
import type { GlyphRun } from "./typesetting";
import { typesetLatex } from "./typesetting";

/** A source that would not set, and what the typesetter said of it. */
export interface Unset {
  readonly source: Source;
  readonly why: string;
}

/**
 * What a source has been set to, and the three questions that may be asked of
 * it.
 *
 * Not exported: it is what {@link createLabelStore} hands back and nothing has
 * a second way to come by one, so a name for the shape would be a name for
 * nobody to say.
 */
interface LabelStore {
  /**
   * The run `source` sets to, or a rejection carrying the reason it will not.
   *
   * The asking door: a refusal already remembered is asked *again* rather than
   * replayed, which is what tells this from {@link LabelStore.runOf}.
   */
  set: (source: Source) => Promise<GlyphRun>;

  /**
   * Set every one of `sources` that has never been set, and hand back the ones
   * that would not set.
   *
   * The filling door: a refusal already remembered is replayed and named again,
   * the engine never asked a second time. Sources are set one after another
   * rather than all at once, so a source two marks share is set once.
   */
  setAll: (sources: readonly Source[]) => Promise<readonly Unset[]>;

  /**
   * What `source` came to, for a caller that cannot wait — or nothing, where it
   * has not been set or would not set at all.
   *
   * The drawing door: it asks nothing and never will, drawing being synchronous
   * where typesetting is not. A source that refused is nothing to draw, which is
   * why the refusal itself does not come back out here.
   */
  runOf: (source: Source) => GlyphRun | undefined;
}

/**
 * A store with nothing set in it yet.
 *
 * Made rather than exported as one, so its bookkeeping can be had fresh — a
 * remembered refusal is the whole point of the thing, and a suite proving that
 * cannot share one with the suite before it.
 */
export function createLabelStore(): LabelStore {
  const runs = new Map<Source, GlyphRun | Error>();

  /** Set `source` now, whatever is remembered of it, and remember what it comes to. */
  async function setNow(source: Source): Promise<GlyphRun | Error> {
    const settled = await typesetLatex(source).catch(
      (failure: unknown) => new Error(messageOf(failure)),
    );
    runs.set(source, settled);
    return settled;
  }

  return {
    async set(source) {
      const known = runs.get(source);
      const run = known === undefined || known instanceof Error ? await setNow(source) : known;
      if (run instanceof Error) {
        throw run;
      }
      return run;
    },

    async setAll(sources) {
      const unset: Unset[] = [];
      for (const source of sources) {
        const run = runs.get(source) ?? (await setNow(source));
        if (run instanceof Error) {
          unset.push({ source, why: run.message });
        }
      }
      return unset;
    },

    runOf(source) {
      const run = runs.get(source);
      return run instanceof Error ? undefined : run;
    },
  };
}
