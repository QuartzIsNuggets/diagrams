// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { createCanvas, enablePlopping } from "./canvas";
import { createEditor } from "./editor";
import { createExportControls } from "./export-svg";
import { createLabelForm } from "./label-form";
import { prewarmTypesetting } from "./typesetting";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app mount point in index.html");
}

const canvas = createCanvas();
enablePlopping(canvas);

const labelForm = createLabelForm(canvas);
const editor = createEditor(canvas, labelForm);
const exportControls = createExportControls(canvas);

// The bar and the export controls float over the canvas rather than sitting in
// the editor, which is the diagram's own region and holds only what reports on
// one.
app.append(editor, labelForm, exportControls);

// The canvas and the bar are on screen now; fetch the typesetter behind them so
// it is ready by the time the first label is submitted.
void prewarmTypesetting();
