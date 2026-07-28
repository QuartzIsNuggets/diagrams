// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

/**
 * The diagram's ink: every mark on the canvas is drawn in it.
 *
 * Set as a presentation attribute rather than a CSS rule — page CSS does not
 * travel with a serialized `<svg>`, and the export slice needs the download to
 * be self-contained.
 */
export const INK = "#111111";
