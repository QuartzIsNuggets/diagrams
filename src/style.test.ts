// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The stylesheet read as text, for the one thing about it no run of the app can
// check: chrome is placed and never translated — see ADR 5,
// agents-working-files/docs/adr/0005-chrome-is-placed-never-translated.md. The
// defect a transform leaves shows in WebKitGTK and on whichever wording happens
// to land on half a device pixel, which is to say almost nowhere a test can
// stand, so what is tested instead is the declaration that would cause it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where a thing rests, said in the properties that say it without laying out.
 *
 * A vendor prefix is one of them and reads the same to the engine, which in an
 * app shipping on WebKitGTK is the very spelling a `-webkit-` reflex reaches
 * for; and a property name is case-insensitive, so this is too.
 */
const PLACEMENT = /^\s*(?:-[a-z]+-)?(?:transform|translate|rotate|scale)\s*:/iu;

// Read off the disk, and by a path rather than a `URL`: the tests run in jsdom,
// whose `URL` is its own class and not the one `node:fs` will take. Importing
// the stylesheet instead — `?raw`, or plain — is what does not work at all here,
// Vite handing a test run an empty string for a CSS module, so the check would
// pass over nothing and go on passing.
const STYLESHEET = readFileSync(join(import.meta.dirname, "style.css"), "utf8");

/**
 * Every placement property `css` declares outside a `@keyframes` block, as the
 * declarations themselves so a failure names what to go and look at.
 *
 * A scan and not a parse: it counts braces, having no use for anything else a
 * rule holds, and would misread a brace inside a string or a `url()` — neither
 * of which this stylesheet has any reason to grow.
 *
 * `@keyframes` is read strictly where the properties are read loosely, so an
 * at-rule spelled any other way loses its frames their exemption and is
 * reported. That is the direction to err in: a wrong report is answered by
 * looking, and a missed one by shipping the blur.
 */
function placementsOutsideKeyframes(css: string): string[] {
  const found: string[] = [];
  let depth = 0;
  // The depth the innermost `@keyframes` opened at, so its own closing brace is
  // the one that ends it — `@media` nests one, and a rule after it is caught
  // again.
  let keyframesAt: number | null = null;
  let pending = "";

  for (const char of css.replaceAll(/\/\*[^]*?\*\//gu, "")) {
    if (char === "{") {
      depth += 1;
      if (keyframesAt === null && /@keyframes\b/u.test(pending)) {
        keyframesAt = depth;
      }
      pending = "";
      continue;
    }
    if (char !== ";" && char !== "}") {
      pending += char;
      continue;
    }
    if (keyframesAt === null && PLACEMENT.test(pending)) {
      found.push(pending.trim());
    }
    pending = "";
    if (char === "}") {
      if (keyframesAt === depth) {
        keyframesAt = null;
      }
      depth -= 1;
    }
  }
  return found;
}

describe("the stylesheet", () => {
  it("places its chrome and never translates it", () => {
    expect(placementsOutsideKeyframes(STYLESHEET)).toEqual([]);
  });

  it("is read by a check that catches a transform written for placement", () => {
    const css = ".canvas-error { top: 16px; transform: translateX(-50%); }";

    expect(placementsOutsideKeyframes(css)).toEqual(["transform: translateX(-50%)"]);
  });

  it("catches the longhands that place a thing just as surely", () => {
    const css = ".a { translate: -50% 0 } .b { rotate: 45deg } .c { scale: 1.5 }";

    expect(placementsOutsideKeyframes(css)).toEqual([
      "translate: -50% 0",
      "rotate: 45deg",
      "scale: 1.5",
    ]);
  });

  it("catches one written the way the engine it blurs in spells it", () => {
    const css = ".canvas-error { -webkit-transform: translateX(-50%); }";

    expect(placementsOutsideKeyframes(css)).toEqual(["-webkit-transform: translateX(-50%)"]);
  });

  it("leaves the frames of an animation alone, wherever the animation is stated", () => {
    const css = `@keyframes balking { 40% { transform: translateX(6px); } }
      @media (prefers-reduced-motion: reduce) {
        @keyframes still { 40% { translate: 6px; } }
      }
      .after { transform: translateX(-50%); }`;

    expect(placementsOutsideKeyframes(css)).toEqual(["transform: translateX(-50%)"]);
  });
});
