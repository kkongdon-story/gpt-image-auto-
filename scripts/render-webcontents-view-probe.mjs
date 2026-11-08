import { app, BaseWindow, WebContentsView } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

const outputPath = path.resolve(
  process.argv[3] ?? "output/m20-webcontents-view-probe.json"
);
app.setPath("userData", path.join(path.dirname(outputPath), ".webcontents-view-probe-profile"));
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  const host = new BaseWindow({ width: 1, height: 1, show: false });
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: { useSharedTexture: false, deviceScaleFactor: 1 },
      sandbox: true
    }
  });

  try {
    host.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 1080, height: 1350 });
    const paintPromise = waitForPaint(view);
    await view.webContents.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<!doctype html><style>html,body{margin:0;width:1080px;height:1350px;overflow:hidden}body{background:#123456}</style>"
        )
    );
    const dom = await view.webContents.executeJavaScript(
      "({innerWidth,innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})"
    );
    view.webContents.invalidate();
    const paint = await paintPromise;
    const payload = {
      dom,
      hostBounds: host.getBounds(),
      paintSize: paint.getSize(),
      scale: app.commandLine.getSwitchValue("force-device-scale-factor") || "default",
      viewBounds: view.getBounds()
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(payload));
  } finally {
    view.webContents.close();
    host.destroy();
  }

  app.exit(0);
});

function waitForPaint(view) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      view.webContents.removeListener("paint", handlePaint);
      reject(new Error("Timed out waiting for WebContentsView paint."));
    }, 5_000);
    const handlePaint = (_event, _dirtyRect, image) => {
      const size = image.getSize();
      if (size.width <= 0 || size.height <= 0) {
        return;
      }
      clearTimeout(timeout);
      view.webContents.removeListener("paint", handlePaint);
      resolve(image);
    };
    view.webContents.on("paint", handlePaint);
  });
}
