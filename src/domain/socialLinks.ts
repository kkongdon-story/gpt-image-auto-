const defaultThreadsHandle = "kkongdon_story";

export function normalizeThreadsHandle(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
}

export function createThreadsProfileUrl(value: string): string {
  const handle = normalizeThreadsHandle(value) || defaultThreadsHandle;
  return `https://www.threads.com/@${encodeURIComponent(handle)}`;
}
