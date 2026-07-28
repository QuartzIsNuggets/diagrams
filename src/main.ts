import { createCanvas } from "./canvas";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app mount point in index.html");
}

app.append(createCanvas());
