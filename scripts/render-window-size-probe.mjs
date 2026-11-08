import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createRenderWindowOptions } from "../src/render-engine/renderWindowConfig.ts";

const outputPath = path.resolve(process.argv[3] ?? "output/m20-window-size-probe.json");
app.setPath("userData", path.join(path.dirname(outputPath), ".window-size-probe-profile"));
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const rows = [];
  for (const requestedHeight of [1348, 1349, 1350, 1351, 1352]) {
    for (const frame of [true, false]) {
      for (const sizingMode of ["constructor", "content", "size", "bounds"]) {
        const window = new BrowserWindow({
          ...createRenderWindowOptions({ width: 1080, height: requestedHeight }),
          frame
        });
      try {
        if (sizingMode === "content") {
          window.setContentSize(1080, requestedHeight);
        } else if (sizingMode === "size") {
          window.setSize(1080, requestedHeight);
        } else if (sizingMode === "bounds") {
          window.setBounds({ width: 1080, height: requestedHeight });
        }
        await window.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent("<!doctype html><style>html,body{margin:0}body{background:#fff}</style>")
        );
        const dom = await window.webContents.executeJavaScript(
          "({innerWidth,innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})"
        );
        const paintSize = await waitForPaintSize(window);
        rows.push({
          browserBounds: window.getBounds(),
          browserContentSize: window.getContentSize(),
          dom,
          frame,
          paintSize,
          requestedHeight,
          sizingMode
        });
      } finally {
        window.destroy();
      }
      }
    }
  }

  const payload = {
    scale: app.commandLine.getSwitchValue("force-device-scale-factor") || "default",
    rows
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
      reject(new Error("Timed out waiting for paint size probe."));
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
