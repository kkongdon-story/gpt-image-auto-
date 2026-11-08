import type { CaptureSize } from "./captureGeometry.js";

export type FinalImageValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "RENDER_CAPTURE_BLANK" | "RENDER_FINAL_SIZE_MISMATCH";
      readonly reason: string;
    };

export function validateFinalImage(input: {
  readonly blank: boolean;
  readonly empty: boolean;
  readonly size: CaptureSize;
  readonly target: CaptureSize;
}): FinalImageValidationResult {
  if (input.blank || input.empty) {
    return {
      ok: false,
      code: "RENDER_CAPTURE_BLANK",
      reason: "The final captured image is blank or empty."
    };
  }

  if (input.size.width !== input.target.width || input.size.height !== input.target.height) {
    return {
      ok: false,
      code: "RENDER_FINAL_SIZE_MISMATCH",
      reason: "The final captured image does not match the exact target dimensions."
    };
  }

  return { ok: true };
}
