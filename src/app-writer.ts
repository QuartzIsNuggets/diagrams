// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import type { DialogFilter } from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

import type { Cancelled, OutgoingFile, Written } from "./writer";

/**
 * Ask where `file` should go, and put it there.
 *
 * Two steps rather than one, and the dialog is not only manners: choosing a
 * path is also what makes the write legal, which is why the app needs no
 * standing right to any directory. `src-tauri/capabilities/default.toml`
 * records how that works and what it buys.
 *
 * The write replaces what is at the path rather than appending to it or
 * inventing a variant name beside it: the user was just shown the directory and
 * said that one.
 *
 * Returning {@link Written} | {@link Cancelled} rather than the whole
 * `WriteResult` narrows this arm the way `HandedOff` narrows the web's. This
 * surface always knows where the bytes went, so `handed-off` is not an answer
 * it should ever be able to give.
 */
export async function saveAs(file: OutgoingFile): Promise<Written | Cancelled> {
  const path = await save({ defaultPath: file.filename, filters: filtersFor(file.filename) });
  if (path === null) {
    return { outcome: "cancelled" };
  }
  await writeTextFile(path, file.contents);
  return { outcome: "written", path };
}

/**
 * What to narrow the dialog to, for a file called `filename`.
 *
 * Bare and singular: Tauri's dialogs take extensions without the leading dot,
 * and handle multi-dot suffixes inconsistently across platforms — a future
 * `.hott.json` is offered as `json` here rather than as something only one
 * platform understands. A name carrying no suffix gets no filter at all, which
 * shows every file rather than none.
 */
function filtersFor(filename: string): DialogFilter[] {
  const extension = /\.([^.]+)$/u.exec(filename)?.[1];
  if (extension === undefined) {
    return [];
  }
  return [{ name: extension.toUpperCase(), extensions: [extension] }];
}
