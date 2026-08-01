// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The writer, exercised through its one door: that is where a caller meets it,
// and the arm it picked stays behind it. The file below is deliberately not an
// SVG — what the writer promises is to put *these* bytes under *that* name, and
// nothing about the diagram they came from.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OutgoingFile } from "./writer";
import { writeFile } from "./writer";

const FILE: OutgoingFile = {
  contents: "whatever the caller handed over\n",
  filename: "chosen-name.txt",
  mediaType: "text/plain;charset=utf-8",
};

/** What the browser was asked to save: the file's name, its bytes, its URL. */
interface Download {
  filename: string;
  blob: Blob;
  url: string;
}

let downloads: Download[] = [];
let revoked: string[] = [];
const blobs = new Map<string, Blob>();

/** The file the browser was handed last. */
function handedOver(): Download {
  const download = downloads.at(-1);
  if (!download) {
    throw new Error("the writer handed the browser no file");
  }
  return download;
}

// jsdom implements neither object URLs nor downloads, so both ends of the
// hand-off are stood in for: the blob is kept so its bytes can be read, and the
// anchor is caught instead of navigating. Installed for the whole file rather
// than per test, because the revoke is deferred by design and so outlives the
// test that scheduled it; vitest gives each test file its own environment, so
// nothing stood in for here leaks past this one.
URL.createObjectURL = (blob: Blob): string => {
  const url = `blob:test/${String(blobs.size)}`;
  blobs.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url: string): void => {
  revoked.push(url);
};
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
  const blob = blobs.get(this.href);
  if (blob) {
    downloads.push({ filename: this.download, blob, url: this.href });
  }
};

beforeEach(() => {
  downloads = [];
  revoked = [];
  blobs.clear();
});

describe("writing a file on the web surface", () => {
  it("hands the browser a file to save, under the name it was given", async () => {
    await writeFile(FILE);

    expect(handedOver().filename).toBe(FILE.filename);
  });

  it("hands over exactly the bytes it was given", async () => {
    await writeFile(FILE);

    await expect(handedOver().blob.text()).resolves.toBe(FILE.contents);
  });

  it("types the file as it was told to, so it opens as what it is", async () => {
    await writeFile(FILE);

    expect(handedOver().blob.type).toBe(FILE.mediaType);
  });

  it("releases the blob URL once the browser has taken it", async () => {
    vi.useFakeTimers();
    try {
      await writeFile(FILE);
      expect(revoked).toEqual([]);
      vi.runAllTimers();
      expect(revoked).toEqual([handedOver().url]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a hand-off, because where the file went is not knowable here", async () => {
    await expect(writeFile(FILE)).resolves.toEqual({ outcome: "handed-off" });
  });

  it("hands over before yielding, so the click that asked is still the user's", () => {
    // Not awaited: a download the browser honours is one the user's gesture is
    // still live for, and an await between the click and the anchor spends
    // that. It is why the web arm is imported statically and the app's is not.
    void writeFile(FILE);

    expect(downloads).toHaveLength(1);
  });
});
