// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

// The writer, exercised through its one door: that is where a caller meets it,
// and the arm it picked stays behind it. The file below is deliberately not an
// SVG — what the writer promises is to put *these* bytes under *that* name, and
// nothing about the diagram they came from.

import type { SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutgoingFile } from "./writer";
import { writeFile } from "./writer";

// The app's two halves, stood in for. What is checked here is the wiring — that
// the dialog is asked, and that its answer decides what happens next. Whether
// WebKitGTK puts a GTK window on screen is outside any jsdom run, and is
// recorded by hand in this feature's `verification/` instead.
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn() }));

const FILE: OutgoingFile = {
  contents: "whatever the caller handed over\n",
  filename: "chosen-name.txt",
  mediaType: "text/plain;charset=utf-8",
};

/** Where the user pointed the save dialog. */
const CHOSEN_PATH = "/home/somebody/notes/chosen-name.txt";

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

/** What the save dialog was opened with. */
function dialogOptions(): SaveDialogOptions {
  const options = vi.mocked(save).mock.lastCall?.[0];
  if (!options) {
    throw new Error("the writer opened no save dialog");
  }
  return options;
}

beforeEach(() => {
  downloads = [];
  revoked = [];
  blobs.clear();
  vi.mocked(save).mockReset();
  vi.mocked(writeTextFile).mockReset();
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

  it("opens no save dialog, there being no app under the tab to answer one", async () => {
    await writeFile(FILE);

    expect(save).not.toHaveBeenCalled();
  });
});

// Stand up what Tauri stamps on the webview's global, around each test in the
// calling block, and take it down after — so the web tests above meet a tab and
// not a half-app. Why the writer reads it at all is recorded in `writer.ts`.
function withTheApp(): void {
  beforeEach(() => {
    Reflect.set(globalThis, "isTauri", true);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "isTauri");
  });
}

describe("writing a file on the app surface", () => {
  withTheApp();

  beforeEach(() => {
    vi.mocked(save).mockResolvedValue(CHOSEN_PATH);
  });

  it("asks the user where the file goes, offering the name it was given", async () => {
    await writeFile(FILE);

    expect(dialogOptions().defaultPath).toBe(FILE.filename);
  });

  it("offers the file's own kind, as the bare extension Tauri's dialogs take", async () => {
    await writeFile(FILE);

    expect(dialogOptions().filters).toEqual([{ name: "TXT", extensions: ["txt"] }]);
  });

  it("writes exactly the bytes it was given, at the path the user chose", async () => {
    await writeFile(FILE);

    expect(writeTextFile).toHaveBeenCalledWith(CHOSEN_PATH, FILE.contents);
  });

  it("reports the path, which is the one thing only this surface can know", async () => {
    await expect(writeFile(FILE)).resolves.toEqual({ outcome: "written", path: CHOSEN_PATH });
  });

  it("never falls back to a download, which the app has no shelf to show", async () => {
    await writeFile(FILE);

    expect(downloads).toEqual([]);
  });

  it("reports no write when the filesystem refused one", async () => {
    // The arm has to wait for the write, not just start it: a `writeTextFile`
    // left unawaited would have this resolve `written` for a file that never
    // landed, and the caller would be told the opposite of what happened.
    const refusal = new Error("read-only file system");
    vi.mocked(writeTextFile).mockRejectedValue(refusal);

    await expect(writeFile(FILE)).rejects.toBe(refusal);
  });
});

describe("dismissing the app's save dialog", () => {
  withTheApp();

  beforeEach(() => {
    // `null` is how the dialog reports a dismissal, and the reason the writer
    // has a `cancelled` arm at all.
    vi.mocked(save).mockResolvedValue(null);
  });

  it("writes nothing", async () => {
    await writeFile(FILE);

    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("reports cancellation, so nothing downstream announces a file", async () => {
    await expect(writeFile(FILE)).resolves.toEqual({ outcome: "cancelled" });
  });
});
