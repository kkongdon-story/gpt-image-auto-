import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createRenderWindowOptions } from "../src/render-engine/renderWindowConfig.ts";

const outputPath = path.resolve(
  process.argv[3] ?? "output/m20-aspect-surface-probe.json"
);
app.setPath("userData", path.join(path.dirname(outputPath), ".aspect-surface-probe-profile"));
app.on("window-all-closed", () => {});

const targets = [
  { id: "4:5", width: 1080, height: 1350, unitWidth: 4, unitHeight: 5 },
  { id: "1:1", width: 1080, height: 1080, unitWidth: 1, unitHeight: 1 },
  { id: "16:9", width: 1920, height: 1080, unitWidth: 16, unitHeight: 9 },
  { id: "4:3", width: 1440, height: 1080, unitWidth: 4, unitHeight: 3 }
];

app.whenReady().then(async () => {
  const rows = [];
  for (const target of targets) {
    for (let decrement = 0; decrement <= 4; decrement += 1) {
      const requested = {
        width: target.width - target.unitWidth * decrement,
        height: target.height - target.unitHeight * decrement
      };
      const window = new BrowserWindow(createRenderWindowOptions(requested));
      try {
        window.setContentSize(requested.width, requested.height);
        await window.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent("<!doctype html><style>html,body{margin:0;overflow:hidden;background:#123456}</style>")
        );
        const dom = await window.webContents.executeJavaScript(
          "({innerWidth,innerHeight,dpr:devicePixelRatio})"
        );
        const paintSize = await waitForPaintSize(window);
        rows.push({ decrement, dom, id: target.id, paintSize, requested });
      } finally {
        window.destroy();
      }
    }
  }

  const payload = {
    rows,
    scale: app.commandLine.getSwitchValue("force-device-scale-factor") || "default"
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload));
  app.exit(0);
});

function waitForPaintSize(window) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.webContents.removeListener("paint", handlePaint);
      reject(new Error("Timed out waiting for aspect surface paint."));
    }, 2_000);
    const handlePaint = (_event, _dirtyRect, image) => {
      const size = image.getSize();
      if (size.width <= 0 || size.height <= 0) {
        return;
      }
      clearTimeout(timeout);
      window.webContents.removeListener("paint", handlePaint);
      resolve(size);
    };
    window.webContents.on("paint", handlePaint);
    window.webContents.invalidate();
  });
}
