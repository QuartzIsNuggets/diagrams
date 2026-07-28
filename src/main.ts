// SPDX-FileCopyrightText: 2026 Alexis Ronez <alexis.ronez@mailfence.com>
//
// SPDX-License-Identifier: MIT

import { createCanvas, enablePlopping } from "./canvas";
import { createLabelForm, enableLabelPlacing, prewarmTypesetting } from "./mathjax-label";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app mount point in index.html");
}

const canvas = createCanvas();
enablePlopping(canvas);

const labelForm = createLabelForm();
enableLabelPlacing(canvas, labelForm);

app.append(canvas, labelForm);

// The canvas and the bar are on screen now; fetch the typesetter behind them so
// it is ready by the time the first label is submitted.
void prewarmTypesetting();
