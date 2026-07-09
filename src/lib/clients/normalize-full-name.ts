export function normalizeClientFullName(fullName: string): string {
  return fullName.trim().toLowerCase().replace(/\s+/g, " ");
}
