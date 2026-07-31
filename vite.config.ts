// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { readFile } from "node:fs/promises";

import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Drop the source-map links from the New Computer Modern font while developing.
 *
 * The package ships `.js.map` files whose `sources` point at TypeScript it does
 * not publish, so every font module served raw logs "points to missing source
 * files" — dozens of them on a cold start, in both the Vite log and the browser
 * console. Nothing is lost by cutting the link: these files are generated glyph
 * tables, and the maps they name do not exist to step into.
 */
function quietFontSourceMaps(): Plugin {
  return {
    name: "quiet-newcm-font-source-maps",
    apply: "serve",
    // Vite reads the map link while loading the file, so stripping it in a
    // `transform` hook would already be too late.
    enforce: "pre",
    async load(id) {
      const file = id.split("?")[0] ?? "";
      if (!file.includes("mathjax-newcm-font") || !file.endsWith(".js")) {
        return null;
      }
      const code = await readFile(file, "utf8");
      return { code: code.replaceAll(/\/\/# sourceMappingURL=\S*/gu, ""), map: null };
    },
  };
}

export default defineConfig({
  plugins: [quietFontSourceMaps()],
  build: { target: "es2022", sourcemap: true },
  // The app window is pointed at a fixed `devUrl`, so Vite quietly moving to
  // the next free port would leave it showing nothing at all. Fail loudly.
  server: { strictPort: true },
  optimizeDeps: {
    // MathJax must resolve to ONE module graph. Its font loads glyph ranges by
    // calling `dynamicSetup` on the font class, and dev pre-bundling would put
    // the ranges (served raw, via the glob in src/font-ranges.ts) and the
    // output jax (served from .vite/deps) in separate graphs — so the glyphs
    // would register on a class the renderer never consults. Both packages are
    // clean ESM, and the production build is a single Rollup graph already.
    exclude: ["@mathjax/src", "@mathjax/mathjax-newcm-font"],
  },
  // The canvas is DOM all the way down, so tests need a document to build into.
  test: { environment: "jsdom" },
});
