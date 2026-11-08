import type { BrowserWindowConstructorOptions } from "electron";
import type { CaptureSize } from "./captureGeometry.js";

export function createRenderWindowOptions(dimensions: CaptureSize): BrowserWindowConstructorOptions {
  return {
    width: dimensions.width,
    height: dimensions.height,
    show: false,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: { useSharedTexture: false, deviceScaleFactor: 1 },
      sandbox: true
    }
  };
}
