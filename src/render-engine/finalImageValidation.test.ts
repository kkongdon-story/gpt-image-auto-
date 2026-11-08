import { describe, expect, it } from "vitest";
import { validateFinalImage } from "./finalImageValidation.js";

describe("final render image validation", () => {
  it("accepts an exact nonblank image", () => {
    expect(
      validateFinalImage({
        blank: false,
        empty: false,
        size: { width: 1080, height: 1350 },
        target: { width: 1080, height: 1350 }
      })
    ).toEqual({ ok: true });
  });

  it.each([
    ["blank", true, false],
    ["empty", false, true]
  ])("rejects a %s capture with the stable blank code", (_label, blank, empty) => {
    expect(
      validateFinalImage({
        blank,
        empty,
        size: { width: 1080, height: 1350 },
        target: { width: 1080, height: 1350 }
      })
    ).toMatchObject({ ok: false, code: "RENDER_CAPTURE_BLANK" });
  });

  it("rejects a post-normalization size mismatch", () => {
    expect(
      validateFinalImage({
        blank: false,
        empty: false,
        size: { width: 1080, height: 1351 },
        target: { width: 1080, height: 1350 }
      })
    ).toMatchObject({ ok: false, code: "RENDER_FINAL_SIZE_MISMATCH" });
  });
});
