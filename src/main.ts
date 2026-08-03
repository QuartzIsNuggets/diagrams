// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { createCanvas } from "./canvas";
import { createEditor } from "./editor";
import { createExportControls } from "./export-svg";
import { createNamingBar } from "./naming-bar";
import { prewarmTypesetting } from "./typesetting";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app mount point in index.html");
}

const canvas = createCanvas();
const namingBar = createNamingBar();
const editor = createEditor(canvas, namingBar);
const exportControls = createExportControls(editor.diagramNow);

// The bar and the export controls float over the canvas rather than sitting in
// the editor, which is the diagram's own region and holds only what reports on
// one.
app.append(editor.region, namingBar, exportControls);

// The canvas and the bar are on screen now; fetch the typesetter behind them so
// it is ready by the time the first label is submitted.
void prewarmTypesetting();
