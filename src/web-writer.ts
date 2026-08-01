// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import type { HandedOff, OutgoingFile } from "./writer";

/**
 * How long to hold the blob URL open after the click that consumes it.
 *
 * Revoking in the same task as `link.click()` has raced the download in
 * Firefox; one turn of the event loop is enough for the browser to have taken
 * the blob, and leaves nothing leaked afterwards. What matters is that the
 * revoke is deferred at all, not the number.
 */
const NEXT_TASK = 0;

/**
 * Hand `file` to the browser to save wherever it saves things.
 *
 * A blob rather than a `data:` URL: a diagram of typeset labels is a lot of
 * path data, and data URLs are length-capped by the browser.
 *
 * Returning the narrow {@link HandedOff} rather than the whole `WriteResult` is
 * what makes this arm's honesty the compiler's business; the reason it can
 * report nothing else is recorded with that type.
 */
export function download(file: OutgoingFile): HandedOff {
  const url = URL.createObjectURL(new Blob([file.contents], { type: file.mediaType }));
  // The anchor never joins the document: a synthetic click on a detached one
  // downloads just the same, and nothing has to be cleaned up after it.
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, NEXT_TASK);
  return { outcome: "handed-off" };
}
