// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

/**
 * What a failure says, whatever kind of thing was thrown.
 *
 * Every refusal the editor has to report comes across a boundary — a plugin, a
 * typesetting engine, a browser API — and none of them promises an `Error`, so
 * every region showing one asks this same question of it. It reads as one line
 * because it is one: the callers differ in what they do with the answer, not in
 * how they get it.
 */
export function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
