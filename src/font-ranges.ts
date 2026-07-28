// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

/**
 * The font's on-demand glyph ranges, as chunks this bundle actually ships.
 *
 * New Computer Modern keeps ~40 ranges out of its main entry — the alphabet
 * variants behind `\mathbb`, `\mathfrak`, `\mathsf` and `\mathtt`, accented
 * Latin, and every non-Latin script — and fetches them only when a glyph needs
 * one. MathJax's own loader builds that import URL at runtime from
 * `import.meta.url`, which Rollup cannot follow, so the files would never be
 * emitted and every range would 404 in a built app.
 *
 * This glob states the same set statically. Rollup sees each one and emits it
 * as its own lazy chunk, so the ranges stay off the critical path but are there
 * the moment a glyph calls for one.
 */
const FONT_RANGES = import.meta.glob(
  "/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js",
);

/** Ranges by bare file name — MathJax asks under `js/`, the files live in `mjs/`. */
const FONT_RANGE_BY_FILE = new Map(
  Object.entries(FONT_RANGES).map(([path, load]) => [basenameOf(path), load]),
);

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Fetch one glyph range on MathJax's behalf — the `mathjax.asyncLoad` hook.
 *
 * MathJax asks by module specifier
 * (`@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js`); the bundle knows the
 * ranges by file name, which is the part the two spellings share.
 */
export async function loadFontRange(file: string): Promise<unknown> {
  const load = FONT_RANGE_BY_FILE.get(basenameOf(file));
  if (!load) {
    throw new Error(`No bundled glyph range for ${JSON.stringify(file)}`);
  }
  return await load();
}
