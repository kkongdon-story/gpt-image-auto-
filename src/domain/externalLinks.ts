export const kakaoInquiryUrl = "https://open.kakao.com/me/kkongdon";

const allowedGptsHosts = new Set(["chatgpt.com", "chat.openai.com"]);
const allowedCliDocumentationUrls = new Set([
  "https://help.openai.com/en/articles/11096431",
  "https://code.claude.com/docs/en/installation"
]);

export function isAllowedGptsTemplateBuilderUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" && allowedGptsHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedExternalUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== "https:") {
      return false;
    }

    if (parsed.href === kakaoInquiryUrl) {
      return true;
    }

    if (parsed.hostname === "www.threads.com") {
      return /^\/@[A-Za-z0-9_.-]+$/.test(parsed.pathname) && parsed.search === "" && parsed.hash === "";
    }

    if (allowedCliDocumentationUrls.has(parsed.href)) {
      return true;
    }

    return isAllowedGptsTemplateBuilderUrl(input);
  } catch {
    return false;
  }
}
