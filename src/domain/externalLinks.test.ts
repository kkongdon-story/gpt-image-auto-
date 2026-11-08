import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl, isAllowedGptsTemplateBuilderUrl, kakaoInquiryUrl } from "./externalLinks.js";

describe("externalLinks", () => {
  it("allows only empty or ChatGPT HTTPS GPTs shortcut URLs", () => {
    expect(isAllowedGptsTemplateBuilderUrl("")).toBe(true);
    expect(isAllowedGptsTemplateBuilderUrl("https://chatgpt.com/g/g-kkongdon-template-builder")).toBe(true);
    expect(isAllowedGptsTemplateBuilderUrl("https://chat.openai.com/g/g-kkongdon-template-builder")).toBe(true);
    expect(isAllowedGptsTemplateBuilderUrl("http://chatgpt.com/g/g-kkongdon-template-builder")).toBe(false);
    expect(isAllowedGptsTemplateBuilderUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedGptsTemplateBuilderUrl("https://example.com/gpts/kkongdon-template-builder")).toBe(false);
  });

  it("centralizes app external link allow-list", () => {
    expect(isAllowedExternalUrl(kakaoInquiryUrl)).toBe(true);
    expect(isAllowedExternalUrl("https://www.threads.com/@kkongdon_story")).toBe(true);
    expect(isAllowedExternalUrl("https://chatgpt.com/g/g-kkongdon-template-builder")).toBe(true);
    expect(isAllowedExternalUrl("https://help.openai.com/en/articles/11096431")).toBe(true);
    expect(isAllowedExternalUrl("https://code.claude.com/docs/en/installation")).toBe(true);
    expect(isAllowedExternalUrl("https://www.threads.com/@kkongdon_story?x=1")).toBe(false);
    expect(isAllowedExternalUrl("https://help.openai.com/en/articles/not-allowlisted")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com")).toBe(false);
  });
});
