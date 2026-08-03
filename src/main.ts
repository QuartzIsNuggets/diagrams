// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { createCanvas } from "./canvas";
import { createEditor } from "./editor";
import { createExportControls } from "./export-svg";
import { prewarmTypesetting } from "./typesetting";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app mount point in index.html");
}

const canvas = createCanvas();
const editor = createEditor(canvas);
const exportControls = createExportControls(editor.diagramNow);

// The export controls float over the canvas rather than sitting in the editor,
// which is the diagram's own region and holds only what reports on one. They
// keep a corner because they act on the whole diagram; the naming bar acts on a
// mark, so it is summoned there by the gesture that asks and appears nowhere in
// this wiring.
app.append(editor.region, exportControls);

// The canvas is on screen now; fetch the typesetter behind it so it is ready by
// the time the first label is submitted.
void prewarmTypesetting();
