import type { BrowserWindow } from "electron";

export type SmokeActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type AiDraftSmokeDependencies = {
  readonly clickSmokeButton: (mainWindow: BrowserWindow, action: string) => Promise<void>;
  readonly readRenderSmokeResult: (mainWindow: BrowserWindow) => Promise<SmokeActionResult>;
  readonly waitForSmokeText: (mainWindow: BrowserWindow, expectedTexts: readonly string[]) => Promise<void>;
};

export function isSmokeRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
