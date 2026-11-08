export function normalizeHexColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
}

export function isHexColor(value: string): boolean {
  return normalizeHexColor(value) !== undefined;
}
