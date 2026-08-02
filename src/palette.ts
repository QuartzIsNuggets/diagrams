// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// This backend's ink, and nothing the model knows about: a diagram records what
// a mark *is*, and each render backend picks what that looks like. Every colour
// here is set as a presentation attribute rather than a CSS rule — page CSS does
// not travel with a serialized `<svg>`, and an export has to stand alone.

/** The diagram's default ink: what a mark is drawn in unless it says otherwise. */
export const INK = "#111111";

/**
 * A box, walls and type expression alike.
 *
 * One colour for the two, a box being a rectangle *labelled with* its type
 * expression rather than a rectangle with something else inside it. It is as
 * light as a type expression can be set and still be read — 4.56:1 on white,
 * where the pale blues above it drop under 3:1 and stop being legible as text at
 * all. Boxes are the only thing on the canvas that is not black, which is what
 * keeps the hue channel free for the [role] an arrow carries.
 */
export const BOX_INK = "#3a7ca5";
