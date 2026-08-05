// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { download } from "./web-writer";

/** A file on its way out of the editor: the bytes, and what to call them. */
export interface OutgoingFile {
  /** The whole file, as text. */
  readonly contents: string;
  /** The name to offer for it; the user may still choose another. */
  readonly filename: string;
  /** What kind of file it is, for the surfaces that ask. */
  readonly mediaType: string;
}

/** The bytes are at a path, and the path is known. Only the app can say this. */
export interface Written {
  readonly outcome: "written";
  readonly path: string;
}

/** The bytes have left, and where they went is not knowable. */
export interface HandedOff {
  readonly outcome: "handed-off";
}

/** Nothing was written: the user dismissed the choice of where. */
export interface Cancelled {
  readonly outcome: "cancelled";
}

/**
 * What became of a file — as much as the surface that took it can honestly say.
 *
 * The three arms are not one flattened to what both surfaces can promise: a
 * download reports neither a destination nor a failure, so the web arm is typed
 * to return {@link HandedOff} and nothing else. That makes it structurally
 * impossible for the web surface to claim a path it never had, or to announce a
 * write the user dismissed.
 */
export type WriteResult = Written | HandedOff | Cancelled;

/**
 * Put `file` where the user chose.
 *
 * The one door for getting bytes out of the editor, and the whole of what it
 * promises. Callers differ in what they hand over and what they do with the
 * result — an export forgets it, a save will remember the path — and none of
 * that is this seam's business. Nor is *obtaining* the choice: every write asks
 * today only because export has no path to hand over, and a caller that has one
 * passes it through this door rather than around it.
 *
 * A promise from the start, because on the app surface it waits on a dialog the
 * user has to answer. The web arm has nothing of its own to wait for and hands
 * the bytes over before it yields, which is what keeps the download riding the
 * click that asked for it. A caller may spend microtasks reaching this door and
 * still ride it — user activation is bounded by time rather than by tasks — and
 * what would spend it is a real wait in front of the call.
 */
export function writeFile(file: OutgoingFile): Promise<WriteResult> {
  if (onTheAppSurface()) {
    // The app's arm is the only thing in the frontend that imports
    // `@tauri-apps/*`, and it is loaded like this so that code lands in a chunk
    // the web build never fetches. The wait costs the app nothing: what follows
    // it is a dialog the user has to answer anyway.
    return import("./app-writer").then(({ write }) => write(file));
  }
  return Promise.resolve(download(file));
}

/**
 * Whether the frontend is running in the app rather than in a browser tab.
 *
 * Tauri stamps `isTauri` onto the webview's global before the frontend loads,
 * and `@tauri-apps/api`'s own `isTauri()` is exactly this read. Reading the
 * global instead of calling that function is what keeps the check synchronous:
 * importing the module that exports it would put either an `await` in front of
 * the web arm's `link.click()`, spending the user gesture the download rides,
 * or `@tauri-apps/*` in the web build's chunk.
 *
 * Looked up rather than declared ambient: a `declare var` would let any module
 * write bare `isTauri`, which is a `ReferenceError` in the tab this very
 * function exists to detect. The one place that reads it is the one place that
 * needs to know it may not be there.
 */
function onTheAppSurface(): boolean {
  return Reflect.get(globalThis, "isTauri") === true;
}
