// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { createCanvas, enablePlopping } from "./canvas";
import { createExportButton } from "./export-svg";
import { createLabelForm } from "./label-form";
import { prewarmTypesetting } from "./typesetting";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app mount point in index.html");
}

const canvas = createCanvas();
enablePlopping(canvas);

const labelForm = createLabelForm(canvas);
const exportButton = createExportButton(canvas);

app.append(canvas, labelForm, exportButton);

// The canvas and the bar are on screen now; fetch the typesetter behind them so
// it is ready by the time the first label is submitted.
void prewarmTypesetting();
