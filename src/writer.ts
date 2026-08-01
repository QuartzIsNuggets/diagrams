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
 * that is this seam's business.
 *
 * A promise from the start, because on the app surface it waits on a dialog the
 * user has to answer. The web arm has nothing to wait for, and is called
 * without awaiting anything first so the download still rides the click that
 * asked for it.
 */
export function writeFile(file: OutgoingFile): Promise<WriteResult> {
  return Promise.resolve(download(file));
}
