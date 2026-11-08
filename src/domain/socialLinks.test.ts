import { describe, expect, it } from "vitest";
import { createThreadsProfileUrl, normalizeThreadsHandle } from "./socialLinks.js";

describe("socialLinks", () => {
  it("normalizes footer display text into a Threads handle only for URLs", () => {
    expect(normalizeThreadsHandle("@kkongdon_story")).toBe("kkongdon_story");
    expect(normalizeThreadsHandle(" kkongdon_story ")).toBe("kkongdon_story");
    expect(normalizeThreadsHandle("@")).toBe("");
  });

  it("builds a Threads profile URL without stripping the displayed footer value", () => {
    expect(createThreadsProfileUrl("@kkongdon_story")).toBe("https://www.threads.com/@kkongdon_story");
    expect(createThreadsProfileUrl("kkongdon_story")).toBe("https://www.threads.com/@kkongdon_story");
    expect(createThreadsProfileUrl("@")).toBe("https://www.threads.com/@kkongdon_story");
  });
});
