// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { defineConfig } from "vitest/config";

export default defineConfig({
  build: { target: "es2022", sourcemap: true },
  // The canvas is DOM all the way down, so tests need a document to build into.
  test: { environment: "jsdom" },
});
